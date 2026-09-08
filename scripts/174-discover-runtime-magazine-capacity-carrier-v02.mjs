import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';

import {
  buildStaticWeaponProfiles,
  discoverReloadEpisodes,
  evaluateMagazineContexts,
  findHeroClipScalingIds,
  MAGAZINE_DISCOVERY_THRESHOLDS,
  normalizeWeaponEvent,
} from '../src/player-state/magazine-capacity-discovery-v02.mjs';

import {
  getClaim,
  loadClaimRegistry,
  requireClaim,
} from '../src/contracts/claim-registry.mjs';

const VERSION =
  'RUNTIME_MAGAZINE_CAPACITY_CARRIER_DISCOVERY_V02';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script174 V02 is discovery-only and must run on test.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 for carrier discovery.',
    ].join('\n'),
  );
}

const PATHS = {
  script161Summary: resolve(
    'output',
    replayName,
    'effective_weapon_state_substrate_v01.json',
  ),
  script161Events: resolve(
    'output',
    replayName,
    'effective_weapon_runtime_events_v01.jsonl',
  ),
  script162: resolve(
    'output',
    replayName,
    'effective_weapon_runtime_semantics_diagnostic_v01.json',
  ),
  script165: resolve(
    'output',
    'cross_replay',
    'primary_weapon_static_cadence_substrate_v02.json',
  ),
  script131: resolve(
    'output',
    'cross_replay',
    'hero_stat_progression_schema_discovery_v01.json',
  ),
  registry: resolve(
    'contracts',
    'claim_registry_v03.json',
  ),
  output: resolve(
    'output',
    replayName,
    'runtime_magazine_capacity_carrier_discovery_v02.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script161 = readJson(PATHS.script161Summary);
const script162 = readJson(PATHS.script162);
const script165 = readJson(PATHS.script165);
const script131 = readJson(PATHS.script131);
const registry = loadClaimRegistry(PATHS.registry);

const readyClaim = requireClaim(
  'runtime_primary_attack_ready_schedule',
  { requireSemantic: true, requireReplication: true },
  registry,
);

const effectiveWeaponClaim =
  getClaim('effective_weapon_state', registry);

const script162Text = JSON.stringify(script162);
const priorMaxAmmoFalsified =
  script162Text.includes(
    'PLAYER_MAX_AMMO_NOT_VALIDATED_AS_MAGAZINE_CAPACITY',
  );

const staticProfiles =
  buildStaticWeaponProfiles(script165);

const heroClipScalingIds =
  findHeroClipScalingIds(script131);

const rows = [];
let jsonlLines = 0;
let jsonlParseFailures = 0;

const reader = createInterface({
  input: createReadStream(
    PATHS.script161Events,
    { encoding: 'utf8' },
  ),
  crlfDelay: Infinity,
});

for await (const line of reader) {
  if (!line.trim()) continue;
  jsonlLines++;

  try {
    rows.push(
      normalizeWeaponEvent(
        JSON.parse(line),
        rows.length,
      ),
    );
  } catch {
    jsonlParseFailures++;
  }
}

const normalizedCoverage = {
  totalRows: rows.length,
  tick:
    rows.filter(row => row.tick !== null).length,
  weaponEntityIndex:
    rows.filter(
      row => row.weaponEntityIndex !== null,
    ).length,
  heroId:
    rows.filter(row => row.heroId !== null).length,
  clip:
    rows.filter(row => row.clip !== null).length,
  inReload:
    rows.filter(row => row.inReload !== null).length,
  effectContextId:
    rows.filter(
      row =>
        row.effectContextId !== null
        && row.effectContextId !==
          'NO_EFFECT_CONTEXT_ID',
    ).length,
};

const discovery = discoverReloadEpisodes(
  rows,
  staticProfiles,
  heroClipScalingIds,
);

const evaluation = evaluateMagazineContexts(
  discovery.contexts,
  MAGAZINE_DISCOVERY_THRESHOLDS,
);

const byHero = buildByHero(evaluation.contexts);

const checks = {
  discoveryReplayOnly: check(
    replayName,
    'test',
    replayName === 'test',
  ),

  script161Ready: check(
    script161?.status,
    'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION',
    script161?.status
      === 'EFFECTIVE_WEAPON_STATE_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION',
  ),

  script165V02Ready: check(
    script165?.status,
    'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION',
    script165?.status
      === 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V02_READY_FOR_INTERPRETATION',
  ),

  priorPlayerMaxAmmoFalsificationPreserved: check(
    priorMaxAmmoFalsified,
    true,
    priorMaxAmmoFalsified,
  ),

  readyScheduleAuthorityCurrentReplicated: check(
    `${readyClaim.authorityStatus}/${readyClaim.replicationStatus}`,
    'current/cross_replay_replicated',
    readyClaim.authorityStatus === 'current'
      && readyClaim.replicationStatus
        === 'cross_replay_replicated',
  ),

  effectiveWeaponStillMissing: check(
    effectiveWeaponClaim?.authorityStatus,
    'missing',
    effectiveWeaponClaim?.authorityStatus
      === 'missing',
  ),

  jsonlParseClean: check(
    jsonlParseFailures,
    0,
    jsonlParseFailures === 0,
  ),

  normalizedTickCoverageStrong: check(
    rate(
      normalizedCoverage.tick,
      normalizedCoverage.totalRows,
    ),
    '>=0.99',
    rate(
      normalizedCoverage.tick,
      normalizedCoverage.totalRows,
    ) >= 0.99,
  ),

  normalizedWeaponIdentityCoverageStrong: check(
    rate(
      normalizedCoverage.weaponEntityIndex,
      normalizedCoverage.totalRows,
    ),
    '>=0.99',
    rate(
      normalizedCoverage.weaponEntityIndex,
      normalizedCoverage.totalRows,
    ) >= 0.99,
  ),

  clipTelemetrySubstantial: check(
    normalizedCoverage.clip,
    '>1000',
    normalizedCoverage.clip > 1000,
  ),

  reloadTelemetrySubstantial: check(
    normalizedCoverage.inReload,
    '>1000',
    normalizedCoverage.inReload > 1000,
  ),

  reloadExitsObserved: check(
    discovery.allReloadExits.length,
    '>100',
    discovery.allReloadExits.length > 100,
  ),

  staticHeroProfilesObserved: check(
    staticProfiles.size,
    '>=42',
    staticProfiles.size >= 42,
  ),
};

const integrityPass =
  Object.values(checks).every(row => row.pass);

const result = {
  version: VERSION,
  canonical: false,
  createdAt: new Date().toISOString(),

  status:
    integrityPass
      ? (
        evaluation.classification
          === 'RELOAD_EXIT_CLIP_PLATEAU_IS_STRONG_RUNTIME_MAGAZINE_CAPACITY_CANDIDATE'
            ? 'RUNTIME_MAGAZINE_CAPACITY_CARRIER_DISCOVERY_V02_READY_FOR_SEMANTIC_VALIDATION'
            : 'RUNTIME_MAGAZINE_CAPACITY_CARRIER_DISCOVERY_V02_REQUIRES_DIAGNOSIS'
      )
      : 'RUNTIME_MAGAZINE_CAPACITY_CARRIER_DISCOVERY_V02_INTEGRITY_FAILURE',

  replay: replayName,

  scientificBoundary: {
    observedCurrentClip: 'm_iClip',
    candidateCapacity:
      'chronologically calibrated modal completion-like reload-exit m_iClip within unchanged player/weapon/effect-context/fire-mode state',
    heldOutValidation:
      'later completion-like reload exits must exactly reproduce the calibrated plateau',
    overshootControl:
      'post-calibration observed m_iClip should almost never exceed the calibrated plateau within the same context',
    staticInputsDiagnosticOnly: [
      'Script165 m_iClipSize',
      'm_iBonusClip',
      'm_flAmmoFrac',
      'Script131 EClipSize scaling',
      'Script165 m_bReloadSingleBullets',
    ],
    excludedFromPrimaryGate: [
      'Script131 EClipSize scaling heroes',
      'static single-bullet reload weapons',
      'contexts with fewer than 6 completion-like reload exits',
    ],
    noFormulaComposition: true,
    discoveryReplayOnly: true,
  },

  thresholds: MAGAZINE_DISCOVERY_THRESHOLDS,

  provenance: {
    script161Summary: PATHS.script161Summary,
    script161Events: PATHS.script161Events,
    script162Diagnostic: PATHS.script162,
    script165StaticWeaponResource: PATHS.script165,
    script131HeroProgression: PATHS.script131,
    claimRegistry: PATHS.registry,
  },

  inputCoverage: {
    jsonlLines,
    jsonlParseFailures,
    normalizedCoverage,
    reloadExits: discovery.allReloadExits.length,
    completionLikeReloadExits:
      discovery.allReloadExits.filter(
        row => row.completionLike,
      ).length,
    staticHeroProfiles: staticProfiles.size,
    heroClipScalingIds:
      [...heroClipScalingIds].sort((a, b) => a - b),
  },

  evaluation: {
    classification: evaluation.classification,
    summary: evaluation.summary,
    contexts: evaluation.contexts,
    byHero,
  },

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      evaluation.classification
        === 'RELOAD_EXIT_CLIP_PLATEAU_IS_STRONG_RUNTIME_MAGAZINE_CAPACITY_CANDIDATE'
        ? 'CANDIDATE_READY_FOR_INDEPENDENT_SEMANTIC_REPLICATION'
        : 'DISCOVERY_REQUIRES_DIAGNOSIS',
    authorityPromotion: false,
    replicationStatus: 'single_replay_only',
  },

  nextStep:
    evaluation.classification
      === 'RELOAD_EXIT_CLIP_PLATEAU_IS_STRONG_RUNTIME_MAGAZINE_CAPACITY_CANDIDATE'
      ? 'FREEZE_CANDIDATE_RULE_THEN_VALIDATE_ON_REP01_TO_REP05_WITHOUT_RETUNING_THRESHOLDS'
      : 'DIAGNOSE_RELOAD_CONTEXT_OUTLIERS_BONUS_CLIP_AND_SPECIAL_RELOAD_MECHANICS_WITHOUT_USING_REPLICATION_COHORT_FOR_DISCOVERY',
};

mkdirSync(
  dirname(PATHS.output),
  { recursive: true },
);

writeFileSync(
  PATHS.output,
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);

print(result);

function buildByHero(contexts) {
  const map = new Map();

  for (const row of contexts) {
    const key = String(row.heroId ?? 'UNKNOWN');

    if (!map.has(key)) {
      map.set(key, {
        heroId: row.heroId,
        contexts: 0,
        primaryEligibleContexts: 0,
        passingContexts: 0,
        completionLikeReloads: 0,
        holdout: {
          exact: 0,
          comparable: 0,
        },
        candidateCapacities: new Set(),
        staticClipSizes: new Set(),
        singleBulletReload: row.singleBulletReload,
        heroClipScaling: row.heroClipScaling,
      });
    }

    const hero = map.get(key);
    hero.contexts++;
    hero.completionLikeReloads +=
      row.completionLikeReloads ?? 0;

    if (row.primaryEligible) {
      hero.primaryEligibleContexts++;
    }

    if (row.contextPass) {
      hero.passingContexts++;
    }

    if (Number.isFinite(row.candidateCapacity)) {
      hero.candidateCapacities.add(
        row.candidateCapacity,
      );
    }

    if (Number.isFinite(row.staticClipSize)) {
      hero.staticClipSizes.add(
        row.staticClipSize,
      );
    }

    hero.holdout.exact +=
      row.holdoutExactMatches ?? 0;
    hero.holdout.comparable +=
      row.holdoutCount ?? 0;
  }

  return [...map.values()]
    .map(row => ({
      ...row,
      candidateCapacities:
        [...row.candidateCapacities]
          .sort((a, b) => a - b),
      staticClipSizes:
        [...row.staticClipSizes]
          .sort((a, b) => a - b),
      holdout: {
        ...row.holdout,
        rate:
          row.holdout.comparable > 0
            ? row.holdout.exact
              / row.holdout.comparable
            : null,
      },
    }))
    .sort(
      (a, b) =>
        b.completionLikeReloads
        - a.completionLikeReloads,
    );
}

function print(result) {
  const summary = result.evaluation.summary;

  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'RUNTIME MAGAZINE CAPACITY CARRIER DISCOVERY V0.2',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    `Replay:                               ${result.replay}`,
  );
  console.log(
    'Replay parsing:                       NONE',
  );
  console.log(
    'Current clip carrier:                 observedWeaponState.clip (Source2 m_iClip)',
  );
  console.log(
    'Script161 adapter:                     V02 exact serialized field aliases',
  );
  console.log(
    'Capacity candidate:                   reload-exit plateau',
  );
  console.log(
    'Static/item formula composition:      NONE',
  );
  console.log(
    'Replication cohort consumed:          NO',
  );
  console.log('');

  console.log('INPUT COVERAGE');
  console.log('--------------');
  console.log(
    `weapon event rows:                    ${result.inputCoverage.normalizedCoverage.totalRows}`,
  );
  console.log(
    `clip rows:                            ${result.inputCoverage.normalizedCoverage.clip}`,
  );
  console.log(
    `reload-state rows:                    ${result.inputCoverage.normalizedCoverage.inReload}`,
  );
  console.log(
    `reload exits:                         ${result.inputCoverage.reloadExits}`,
  );
  console.log(
    `completion-like reload exits:         ${result.inputCoverage.completionLikeReloadExits}`,
  );
  console.log(
    `Script131 EClipSize scaling heroes:   ${JSON.stringify(result.inputCoverage.heroClipScalingIds)}`,
  );
  console.log('');

  console.log('PRIMARY HOLDOUT TEST');
  console.log('--------------------');
  console.log(
    `contexts total:                       ${summary.contextCount}`,
  );
  console.log(
    `primary eligible contexts:            ${summary.primaryEligibleContexts}`,
  );
  console.log(
    `passing contexts:                     ${summary.primaryStableContexts}`,
  );
  console.log(
    `holdout reload exits:                 ${summary.holdoutReloadExits}`,
  );
  console.log(
    `holdout exact plateau agreement:      ${summary.holdoutExactMatches}/${summary.holdoutReloadExits} (${percent(summary.holdoutExactAgreementRate)})`,
  );
  console.log(
    `post-calibration clip overshoots:      ${summary.postCalibrationOvershoots}/${summary.postCalibrationClipObservations} (${percent(summary.postCalibrationOvershootRate)})`,
  );
  console.log('');

  console.log('BY HERO');
  console.log('-------');
  for (const hero of result.evaluation.byHero) {
    console.log(
      `hero=${String(hero.heroId).padEnd(4)} contexts=${String(hero.contexts).padEnd(3)} eligible=${String(hero.primaryEligibleContexts).padEnd(3)} reloads=${String(hero.completionLikeReloads).padEnd(5)} holdout=${percent(hero.holdout.rate).padEnd(7)} candidates=${JSON.stringify(hero.candidateCapacities)} static=${JSON.stringify(hero.staticClipSizes)} single=${hero.singleBulletReload} scaling=${hero.heroClipScaling}`,
    );
  }
  console.log('');

  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');
  for (
    const [name, row]
    of Object.entries(
      result.integrityValidation.checks,
    )
  ) {
    console.log(
      `${name.padEnd(46)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }
  console.log('');

  console.log('CLASSIFICATION');
  console.log('--------------');
  console.log(result.evaluation.classification);
  console.log('');
  console.log(`status: ${result.status}`);
  console.log(`NEXT STAGE: ${result.nextStep}`);
  console.log('');
  console.log(`JSON:\n${PATHS.output}`);
}

function readJson(path) {
  return JSON.parse(
    readFileSync(path, 'utf8'),
  );
}

function check(actual, expected, pass) {
  return {
    actual,
    expected,
    pass: Boolean(pass),
  };
}

function rate(numerator, denominator) {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function percent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : 'n/a';
}
