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
  attachEventsToCandidateContexts,
  candidateContextMap,
  extractStaticAmmoProfiles,
  MAGAZINE_SEMANTIC_THRESHOLDS,
  normalizeSemanticWeaponEvent,
  summarizeMagazineSemantics,
} from '../src/player-state/magazine-capacity-semantics.mjs';

import {
  getClaim,
  loadClaimRegistry,
} from '../src/contracts/claim-registry.mjs';

const VERSION =
  'RUNTIME_MAGAZINE_CAPACITY_SEMANTIC_DIAGNOSTIC_V01';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script175 is discovery semantics only and must run on test.',
      `Received replay=${replayName}.`,
      'Do not use rep01-rep05 before the carrier semantics are frozen.',
    ].join('\n'),
  );
}

const PATHS = {
  script174: resolve(
    'output',
    'test',
    'runtime_magazine_capacity_carrier_discovery_v02.json',
  ),
  script161Events: resolve(
    'output',
    'test',
    'effective_weapon_runtime_events_v01.jsonl',
  ),
  script165: resolve(
    'output',
    'cross_replay',
    'primary_weapon_static_cadence_substrate_v02.json',
  ),
  registry: resolve(
    'contracts',
    'claim_registry_v03.json',
  ),
  output: resolve(
    'output',
    'test',
    'runtime_magazine_capacity_semantic_diagnostic_v01.json',
  ),
};

for (const [name, path] of Object.entries(PATHS)) {
  if (name === 'output') continue;
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}:\n${path}`);
  }
}

const script174 = readJson(PATHS.script174);
const script165 = readJson(PATHS.script165);
const registry = loadClaimRegistry(PATHS.registry);
const effectiveWeapon =
  getClaim('effective_weapon_state', registry);

const expected174Status =
  'RUNTIME_MAGAZINE_CAPACITY_CARRIER_DISCOVERY_V02_READY_FOR_SEMANTIC_VALIDATION';

const candidates =
  candidateContextMap(script174);

const events = [];
let parseFailures = 0;

const reader = createInterface({
  input: createReadStream(
    PATHS.script161Events,
    { encoding: 'utf8' },
  ),
  crlfDelay: Infinity,
});

for await (const line of reader) {
  if (!line.trim()) continue;

  try {
    events.push(
      normalizeSemanticWeaponEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped =
  attachEventsToCandidateContexts(
    events,
    candidates,
  );

const staticProfiles =
  extractStaticAmmoProfiles(script165);

const evaluation =
  summarizeMagazineSemantics(
    grouped,
    staticProfiles,
    MAGAZINE_SEMANTIC_THRESHOLDS,
  );

const byHero = summarizeByHero(evaluation.rows);

const checks = {
  script174V02Ready: check(
    script174?.status,
    expected174Status,
    script174?.status === expected174Status,
  ),

  script174StrongCandidateClassification: check(
    script174?.evaluation?.classification,
    'RELOAD_EXIT_CLIP_PLATEAU_IS_STRONG_RUNTIME_MAGAZINE_CAPACITY_CANDIDATE',
    script174?.evaluation?.classification
      === 'RELOAD_EXIT_CLIP_PLATEAU_IS_STRONG_RUNTIME_MAGAZINE_CAPACITY_CANDIDATE',
  ),

  script174CandidateContextsFrozen: check(
    script174?.evaluation?.summary?.primaryEligibleContexts,
    54,
    script174?.evaluation?.summary?.primaryEligibleContexts
      === 54,
  ),

  script174HoldoutFrozen: check(
    {
      exact:
        script174?.evaluation?.summary
          ?.holdoutExactMatches,
      comparable:
        script174?.evaluation?.summary
          ?.holdoutReloadExits,
    },
    { exact: 469, comparable: 469 },
    script174?.evaluation?.summary
      ?.holdoutExactMatches === 469
      && script174?.evaluation?.summary
        ?.holdoutReloadExits === 469,
  ),

  exactCandidateContextRecovery: check(
    grouped.length,
    54,
    grouped.length === 54,
  ),

  eventParseClean: check(
    parseFailures,
    0,
    parseFailures === 0,
  ),

  staticProfilesObserved: check(
    staticProfiles.size,
    '>=42',
    staticProfiles.size >= 42,
  ),

  effectiveWeaponStillMissing: check(
    effectiveWeapon?.authorityStatus,
    'missing',
    effectiveWeapon?.authorityStatus
      === 'missing',
  ),

  replicationCohortStillUnused: check(
    replayName,
    'test',
    replayName === 'test',
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
          === 'RELOAD_EXIT_PLATEAU_SUPPORTED_AS_OBSERVED_RUNTIME_CLIP_CEILING_STATIC_MAPPING_UNRESOLVED'
          ? 'RUNTIME_MAGAZINE_CAPACITY_SEMANTIC_DIAGNOSTIC_V01_READY_TO_FREEZE_CARRIER'
          : 'RUNTIME_MAGAZINE_CAPACITY_SEMANTIC_DIAGNOSTIC_V01_REQUIRES_DIAGNOSIS'
      )
      : 'RUNTIME_MAGAZINE_CAPACITY_SEMANTIC_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  replay: replayName,

  frozenBeforeResult: {
    thresholds: MAGAZINE_SEMANTIC_THRESHOLDS,
    primaryQuestions: [
      'Does each Script174 candidate equal the maximum observed m_iClip in its unchanged context?',
      'Does reload-exit m_iClip settle upward within 4 ticks without a new shot?',
      'What observed clip decrement accompanies firing and how does it compare to static m_iAmmoConsumedPerShot?',
    ],
    noThresholdRetuning: true,
  },

  authorityBoundary: {
    observedCurrentClip:
      'Script161 observedWeaponState.clip (Source2 m_iClip)',
    candidateCapacity:
      'Script174 V02 calibrated reload-exit plateau',
    semanticTarget:
      'empirical runtime clip ceiling within unchanged player/weapon/effect-context/fire-mode state',
    notYetEstablished: [
      'static m_iClipSize mapping',
      'm_iBonusClip composition',
      'item/buff clip-size formula',
      'hero EClipSize scaling formula',
      'single-bullet reload semantics',
      'cross-replay replication',
      'full effective_weapon_state',
    ],
  },

  evaluation: {
    classification: evaluation.classification,
    summary: evaluation.summary,
    rows: evaluation.rows,
    byHero,
  },

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      evaluation.classification
        === 'RELOAD_EXIT_PLATEAU_SUPPORTED_AS_OBSERVED_RUNTIME_CLIP_CEILING_STATIC_MAPPING_UNRESOLVED'
        ? 'OBSERVED_RUNTIME_CLIP_CEILING_CANDIDATE_SUPPORTED_SINGLE_REPLAY'
        : 'NOT_ESTABLISHED',
    replicationStatus: 'single_replay_only',
    authorityPromotion: false,
  },

  nextStep:
    evaluation.classification
      === 'RELOAD_EXIT_PLATEAU_SUPPORTED_AS_OBSERVED_RUNTIME_CLIP_CEILING_STATIC_MAPPING_UNRESOLVED'
      ? 'FREEZE_OBSERVED_CLIP_CEILING_RULE_THEN_CROSS_REPLAY_VALIDATE_ON_REP01_TO_REP05;_KEEP_STATIC_CAPACITY_COMPOSITION_SEPARATE'
      : 'DIAGNOSE_CONTEXT_CEILING_OR_RELOAD_SETTLEMENT_FAILURES_ON_TEST_ONLY',
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

function summarizeByHero(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = String(row.heroId ?? 'UNKNOWN');

    if (!map.has(key)) {
      map.set(key, {
        heroId: row.heroId,
        contexts: 0,
        exactCeilingContexts: 0,
        settlementComparable: 0,
        upwardSettlements: 0,
        firingDecrementContexts: 0,
        candidateCapacities: new Set(),
        staticClipSizes: new Set(),
        staticAmmoConsumed: new Set(),
        observedModeDecrements: new Set(),
      });
    }

    const hero = map.get(key);
    hero.contexts++;

    if (row.ceiling.exactCeiling) {
      hero.exactCeilingContexts++;
    }

    hero.settlementComparable +=
      row.settlement.comparable;
    hero.upwardSettlements +=
      row.settlement.increasedWithoutShot;

    if (row.decrement.observations > 0) {
      hero.firingDecrementContexts++;
    }

    if (Number.isFinite(row.candidateCapacity)) {
      hero.candidateCapacities.add(
        row.candidateCapacity,
      );
    }

    const comparison = row.staticComparison;

    if (Number.isFinite(comparison.staticClipSize)) {
      hero.staticClipSizes.add(
        comparison.staticClipSize,
      );
    }

    if (
      Number.isFinite(
        comparison.staticAmmoConsumedPerShot,
      )
    ) {
      hero.staticAmmoConsumed.add(
        comparison.staticAmmoConsumedPerShot,
      );
    }

    if (
      Number.isFinite(
        comparison.observedModeClipDecrement,
      )
    ) {
      hero.observedModeDecrements.add(
        comparison.observedModeClipDecrement,
      );
    }
  }

  return [...map.values()]
    .map(row => ({
      heroId: row.heroId,
      contexts: row.contexts,
      exactCeilingContexts:
        row.exactCeilingContexts,
      ceilingRate:
        row.contexts > 0
          ? row.exactCeilingContexts
            / row.contexts
          : null,
      settlementComparable:
        row.settlementComparable,
      upwardSettlements:
        row.upwardSettlements,
      upwardSettlementRate:
        row.settlementComparable > 0
          ? row.upwardSettlements
            / row.settlementComparable
          : null,
      firingDecrementContexts:
        row.firingDecrementContexts,
      candidateCapacities:
        [...row.candidateCapacities]
          .sort((a, b) => a - b),
      staticClipSizes:
        [...row.staticClipSizes]
          .sort((a, b) => a - b),
      staticAmmoConsumed:
        [...row.staticAmmoConsumed]
          .sort((a, b) => a - b),
      observedModeDecrements:
        [...row.observedModeDecrements]
          .sort((a, b) => a - b),
    }))
    .sort(
      (a, b) =>
        b.contexts - a.contexts
        || (a.heroId ?? 0) - (b.heroId ?? 0),
    );
}

function print(result) {
  const summary = result.evaluation.summary;

  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'RUNTIME MAGAZINE CAPACITY SEMANTIC DIAGNOSTIC V0.1',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    'Replay:                              test',
  );
  console.log(
    'Replication cohort consumed:         NO',
  );
  console.log(
    'Script174 thresholds retuned:         NO',
  );
  console.log(
    'Static capacity formula composed:     NO',
  );
  console.log('');

  console.log('OBSERVED CLIP CEILING');
  console.log('---------------------');
  console.log(
    `candidate contexts:                   ${summary.candidateContexts}`,
  );
  console.log(
    `candidate reload exits:               ${summary.candidateReloadExits}`,
  );
  console.log(
    `candidate == full context max clip:    ${summary.exactCeilingContexts}/${summary.candidateContexts} (${percent(summary.contextCeilingAgreementRate)})`,
  );
  console.log('');

  console.log('RELOAD-EXIT SHORT-HORIZON SETTLEMENT');
  console.log('------------------------------------');
  console.log(
    `comparable reload exits:               ${summary.reloadExitSettlementComparable}`,
  );
  console.log(
    `clip increased without a new shot:     ${summary.reloadExitUpwardSettlements}/${summary.reloadExitSettlementComparable} (${percent(summary.reloadExitUpwardSettlementRate)})`,
  );
  console.log('');

  console.log('FIRING CLIP-DECREMENT DIAGNOSTIC');
  console.log('--------------------------------');
  console.log(
    `contexts with firing decrement data:   ${summary.contextsWithFiringDecrementEvidence}/${summary.candidateContexts}`,
  );
  console.log('');

  console.log('BY HERO');
  console.log('-------');

  for (const hero of result.evaluation.byHero) {
    console.log(
      `hero=${String(hero.heroId).padEnd(4)} contexts=${String(hero.contexts).padEnd(3)} ceiling=${percent(hero.ceilingRate).padEnd(7)} settleUp=${percent(hero.upwardSettlementRate).padEnd(7)} candidate=${JSON.stringify(hero.candidateCapacities)} staticClip=${JSON.stringify(hero.staticClipSizes)} staticAmmoPerShot=${JSON.stringify(hero.staticAmmoConsumed)} observedDec=${JSON.stringify(hero.observedModeDecrements)}`,
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
      `${name.padEnd(44)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
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

function percent(value) {
  return Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : 'n/a';
}
