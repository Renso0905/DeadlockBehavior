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
  buildCandidateContextsFromScript175,
  diagnoseCeilingOutlier,
  failingCeilingContexts,
  groupEventsByContext,
  normalizeOutlierEvent,
  summarizeAllContextPerShotConsumption,
} from '../src/player-state/magazine-capacity-outlier-diagnostic.mjs';

const VERSION =
  'MAGAZINE_CAPACITY_CEILING_OUTLIER_DIAGNOSTIC_V01';

const replayName =
  String(process.argv[2] ?? 'test')
    .replace(/^.*[\\/]/, '')
    .replace(/\.dem$/i, '');

if (replayName !== 'test') {
  throw new Error(
    [
      'Script176 is test-only outlier diagnosis.',
      `Received replay=${replayName}.`,
      'Do not consume rep01-rep05 yet.',
    ].join('\n'),
  );
}

const PATHS = {
  script175: resolve(
    'output',
    'test',
    'runtime_magazine_capacity_semantic_diagnostic_v01.json',
  ),
  script161Events: resolve(
    'output',
    'test',
    'effective_weapon_runtime_events_v01.jsonl',
  ),
  output: resolve(
    'output',
    'test',
    'magazine_capacity_ceiling_outlier_diagnostic_v01.json',
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

const script175 =
  readJson(PATHS.script175);

const EXPECTED_175_STATUS =
  'RUNTIME_MAGAZINE_CAPACITY_SEMANTIC_DIAGNOSTIC_V01_REQUIRES_DIAGNOSIS';

const EXPECTED_175_CLASSIFICATION =
  'RELOAD_EXIT_PLATEAU_CAPACITY_SEMANTICS_REQUIRE_DIAGNOSIS';

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
      normalizeOutlierEvent(
        JSON.parse(line),
        events.length,
      ),
    );
  } catch {
    parseFailures++;
  }
}

const grouped =
  groupEventsByContext(events);

const failures =
  failingCeilingContexts(script175);

const diagnosedFailures =
  failures.map(failure => ({
    ...diagnoseCeilingOutlier(
      failure,
      grouped.get(failure.contextKey)
      ?? [],
    ),
  }));

const candidateContexts =
  buildCandidateContextsFromScript175(
    script175,
    grouped,
  );

const perShotConsumption =
  summarizeAllContextPerShotConsumption(
    candidateContexts,
  );

const totalOvershootEvents =
  diagnosedFailures.reduce(
    (sum, row) =>
      sum + row.overshootEventCount,
    0,
  );

const overshootClassifications = {};

for (const row of diagnosedFailures) {
  for (
    const [key, value]
    of Object.entries(
      row.overshootClassifications,
    )
  ) {
    overshootClassifications[key] =
      (overshootClassifications[key] ?? 0)
      + value;
  }
}

const checks = {
  script175StatusExpected: check(
    script175?.status,
    EXPECTED_175_STATUS,
    script175?.status
      === EXPECTED_175_STATUS,
  ),

  script175ClassificationExpected: check(
    script175?.evaluation?.classification,
    EXPECTED_175_CLASSIFICATION,
    script175?.evaluation?.classification
      === EXPECTED_175_CLASSIFICATION,
  ),

  script175CandidateContextsFrozen: check(
    script175?.evaluation?.summary
      ?.candidateContexts,
    54,
    script175?.evaluation?.summary
      ?.candidateContexts === 54,
  ),

  script175CeilingCountFrozen: check(
    {
      exact:
        script175?.evaluation?.summary
          ?.exactCeilingContexts,
      total:
        script175?.evaluation?.summary
          ?.candidateContexts,
    },
    { exact: 51, total: 54 },
    script175?.evaluation?.summary
      ?.exactCeilingContexts === 51
      && script175?.evaluation?.summary
        ?.candidateContexts === 54,
  ),

  exactlyThreeFailingContextsRecovered: check(
    failures.length,
    3,
    failures.length === 3,
  ),

  allFailingContextsHaveEvents: check(
    diagnosedFailures.filter(
      row => row.eventCount > 0,
    ).length,
    3,
    diagnosedFailures.every(
      row => row.eventCount > 0,
    ),
  ),

  overshootEventsRecovered: check(
    totalOvershootEvents,
    '>0',
    totalOvershootEvents > 0,
  ),

  eventParseClean: check(
    parseFailures,
    0,
    parseFailures === 0,
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
      ? 'MAGAZINE_CAPACITY_CEILING_OUTLIER_DIAGNOSTIC_V01_READY_FOR_INTERPRETATION'
      : 'MAGAZINE_CAPACITY_CEILING_OUTLIER_DIAGNOSTIC_V01_INTEGRITY_FAILURE',

  replay: replayName,

  scientificBoundary: {
    thresholdsRetuned: false,
    Script174CandidateChanged: false,
    replicationCohortConsumed: false,
    questions: [
      'What exact event type produces m_iClip above the stable reload-exit plateau?',
      'Is the above-plateau state associated with reload, a shot, bonusClip, context entry, or a no-shot clip increase?',
      'What is observed clip drop per shot after dividing by the actual shot-number advance?',
    ],
  },

  failingContexts: diagnosedFailures,

  aggregate: {
    failingContextCount:
      diagnosedFailures.length,
    totalOvershootEvents,
    overshootClassifications,
    perShotConsumption,
  },

  integrityValidation: {
    pass: integrityPass,
    checks,
  },

  nextStep:
    'INTERPRET_OVERSHOOT_MECHANISM_ON_TEST_ONLY;_DO_NOT_LOWER_SCRIPT175_CEILING_GATE_OR_USE_REPLICATION_COHORT_YET',
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

function print(result) {
  console.log('');
  console.log(
    '========================================================',
  );
  console.log(
    'MAGAZINE CAPACITY CEILING OUTLIER DIAGNOSTIC V0.1',
  );
  console.log(
    '========================================================',
  );
  console.log('');

  console.log(
    'Replay:                              test',
  );
  console.log(
    'Script175 ceiling gate retuned:       NO',
  );
  console.log(
    'Replication cohort consumed:          NO',
  );
  console.log('');

  console.log('FAILURE REPRODUCTION');
  console.log('--------------------');
  console.log(
    `failing contexts:                     ${result.aggregate.failingContextCount}`,
  );
  console.log(
    `above-candidate events:                ${result.aggregate.totalOvershootEvents}`,
  );
  console.log(
    `classifications:                       ${JSON.stringify(result.aggregate.overshootClassifications)}`,
  );
  console.log('');

  console.log('FAILING CONTEXTS');
  console.log('----------------');

  for (
    const context
    of result.failingContexts
  ) {
    console.log(
      `hero=${context.heroId} candidate=${context.candidateCapacity} observedMax=${context.observedMaxClip} overshootEvents=${context.overshootEventCount} classes=${JSON.stringify(context.overshootClassifications)}`,
    );

    for (
      const event
      of context.overshootEvents
    ) {
      console.log(
        `  tick=${event.tick} clip=${event.clip} excess=${event.excess} class=${event.classification} deltaClip=${event.deltas.clip} deltaBonus=${event.deltas.bonusClip} deltaShots=${event.deltas.shotNumber} reload=${event.current?.inReload} changed=${JSON.stringify(event.current?.changedFields)}`,
      );
    }
  }

  console.log('');
  console.log(
    'PER-SHOT CLIP CONSUMPTION (CORRECTED)',
  );
  console.log(
    '-------------------------------------',
  );

  const pooled =
    result.aggregate
      .perShotConsumption
      .pooled;

  console.log(
    `observations:                          ${pooled.observations}`,
  );
  console.log(
    `mode clip drop / shot:                 ${pooled.modePerShotClipDrop}`,
  );
  console.log(
    `mode dominance:                        ${percent(pooled.modeDominance)}`,
  );
  console.log(
    `median clip drop / shot:               ${pooled.medianPerShotClipDrop}`,
  );
  console.log(
    `integer per-shot rate:                 ${percent(pooled.integerPerShotRate)}`,
  );
  console.log('');

  console.log('BY CONTEXT / HERO CONSUMPTION');
  console.log('-----------------------------');

  for (
    const row
    of result.aggregate
      .perShotConsumption
      .perContext
  ) {
    const d = row.diagnostic;

    console.log(
      `hero=${String(row.heroId).padEnd(4)} candidate=${String(row.candidateCapacity).padEnd(5)} n=${String(d.observations).padEnd(5)} mode=${String(d.modePerShotClipDrop).padEnd(7)} dominance=${percent(d.modeDominance).padEnd(7)} median=${d.medianPerShotClipDrop}`,
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
