import {
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
  buildCandidateSpecs,
  scanRawResourceCorpus,
} from '../src/vdata/raw-ammo-candidate-resource-discovery.mjs';

const VERSION =
  'RAW_AMMO_CANDIDATE_RESOURCE_DISCOVERY_V01';

const ROOT =
  resolve(
    process.env.DEADLOCK_RESOURCE_SEARCH_ROOT
    ?? '.',
  );

const PATHS = {
  script204:
    resolve(
      'output',
      'cross_replay',
      'ammo_candidate_resource_semantics_audit_v02.json',
    ),

  effects:
    resolve(
      'output',
      'cross_replay',
      'standard_shop_item_effect_substrate_v03.json',
    ),

  output:
    resolve(
      'output',
      'cross_replay',
      'raw_ammo_candidate_resource_discovery_v01.json',
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

const script204 =
  JSON.parse(
    readFileSync(
      PATHS.script204,
      'utf8',
    ),
  );

const effects =
  JSON.parse(
    readFileSync(
      PATHS.effects,
      'utf8',
    ),
  );

console.log('');
console.log(
  '========================================================',
);
console.log(
  'RAW AMMO CANDIDATE RESOURCE DISCOVERY V0.1',
);
console.log(
  '========================================================',
);
console.log('');
console.log(
  `Search root: ${ROOT}`,
);
console.log(
  'Generated output/replays/node_modules/.git excluded: YES',
);
console.log(
  'Candidate universe: Script204 V02 18 items',
);
console.log(
  'Related records: item recordKey + Script139 nested modifier classes',
);
console.log(
  'Goal: recover raw ammo/reload field assignments omitted from Script139',
);
console.log(
  'Runtime causality: NO',
);
console.log(
  'Authority promotion: NO',
);
console.log('');

const candidates =
  buildCandidateSpecs({
    script204,
    effects,
  });

const discovery =
  scanRawResourceCorpus({
    root:
      ROOT,
    candidateSpecs:
      candidates,
  });

const fiveCurrentFieldKeys =
  new Set([
    'upgrade_ethereal_bullets',
    'upgrade_express_shot',
    'upgrade_glass_cannon',
    'upgrade_quick_silver',
    'upgrade_surging_power',
  ]);

const fiveRows =
  discovery.rows.filter(
    row =>
      fiveCurrentFieldKeys.has(
        row.recordKey,
      ),
  );

const checks = {
  script204Ready:
    check(
      script204?.status,
      'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V02_READY_FOR_INTERPRETATION',
      script204?.status
        === 'AMMO_CANDIDATE_RESOURCE_SEMANTICS_AUDIT_V02_READY_FOR_INTERPRETATION',
    ),

  exactly18Candidates:
    check(
      candidates.length,
      18,
      candidates.length === 18,
    ),

  fiveCurrentFieldCandidatesPresent:
    check(
      fiveRows.length,
      5,
      fiveRows.length === 5,
    ),

  searchRootExists:
    check(
      existsSync(ROOT),
      true,
      existsSync(ROOT),
    ),

  textCorpusObserved:
    check(
      discovery.filesConsidered,
      '>0',
      discovery.filesConsidered > 0,
    ),

  readFailuresZero:
    check(
      discovery.readFailures,
      0,
      discovery.readFailures === 0,
    ),
};

const integrityPass =
  Object.values(checks)
    .every(
      row => row.pass,
    );

let semanticStatus =
  'RAW_RESOURCE_CORPUS_SEARCHED_NO_CURRENT_VALUES_RECOVERED';

if (
  discovery.candidatesWithParsedCurrentValues
  > 0
) {
  semanticStatus =
    'RAW_CURRENT_AMMO_VALUES_RECOVERED_FOR_AT_LEAST_ONE_CANDIDATE';
} else if (
  discovery.candidatesWithCurrentFieldAssignments
  > 0
) {
  semanticStatus =
    'RAW_CURRENT_AMMO_FIELDS_FOUND_BUT_ASSIGNMENT_VALUES_UNRESOLVED';
} else if (
  discovery.candidatesWithBalancedBlocks
  === 0
) {
  semanticStatus =
    'RAW_RESOURCE_RECORD_BLOCKS_NOT_FOUND_UNDER_SEARCH_ROOT';
}

const result = {
  version:
    VERSION,

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  status:
    integrityPass
      ? 'RAW_AMMO_CANDIDATE_RESOURCE_DISCOVERY_V01_READY_FOR_INTERPRETATION'
      : 'RAW_AMMO_CANDIDATE_RESOURCE_DISCOVERY_V01_INTEGRITY_FAILURE',

  scientificBoundary: {
    searchRoot:
      ROOT,

    candidateUniverse:
      'Script204 V02 18-item strict resource audit',

    excludes: [
      '.git',
      'node_modules',
      'output',
      'replays',
      'coverage',
      '.cache',
      'dist',
      'build',
    ],

    exactRecordBlockRequired:
      true,

    purpose:
      'recover raw resource assignments not retained by Script139',

    lexicalDiscoveryOnly:
      true,

    runtimeCausality:
      false,

    authorityPromotion:
      false,

    replicationStatus:
      'resource_build_bound',
  },

  discovery,

  semanticStatus,

  integrityValidation: {
    pass:
      integrityPass,
    checks,
  },

  semanticValidation: {
    status:
      semanticStatus,

    authorityPromotion:
      false,

    replicationStatus:
      'resource_build_bound',
  },

  nextStep:
    !integrityPass
      ? 'STOP_AND_DIAGNOSE_RAW_RESOURCE_SEARCH_INTEGRITY'
      : discovery.candidatesWithParsedCurrentValues > 0
        ? 'FREEZE_RECOVERED_RAW_VALUES_AS_RESOURCE_HYPOTHESES_AND_VERIFY_EXACT_RECORD_INHERITANCE_OR_MODIFIER_SEMANTICS'
        : discovery.candidatesWithBalancedBlocks > 0
          ? 'TRACE_FIELD_VALUES_THROUGH_PARENT_OR_NESTED_MODIFIER_RECORDS_FOR_UNRESOLVED_CURRENT_AMMO_FIELDS'
          : 'POINT_DEADLOCK_RESOURCE_SEARCH_ROOT_AT_THE_RAW_EXTRACTED_GAME_RESOURCE_DIRECTORY_AND_RERUN_SCRIPT205',
};

mkdirSync(
  dirname(PATHS.output),
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

function print(result) {
  const d =
    result.discovery;

  console.log(
    'CORPUS SUMMARY',
  );
  console.log(
    '--------------',
  );
  console.log(
    `files considered:                    ${d.filesConsidered}`,
  );
  console.log(
    `files read:                          ${d.filesRead}`,
  );
  console.log(
    `read failures:                       ${d.readFailures}`,
  );
  console.log(
    `candidate records with file hits:    ${d.candidatesWithFileHits}/18`,
  );
  console.log(
    `candidate records with blocks:       ${d.candidatesWithBalancedBlocks}/18`,
  );
  console.log(
    `current-field assignments found:     ${d.candidatesWithCurrentFieldAssignments}/18`,
  );
  console.log(
    `parsed current-ammo values found:    ${d.candidatesWithParsedCurrentValues}/18`,
  );
  console.log('');

  console.log(
    'CANDIDATE RAW RESOURCE RESULTS',
  );
  console.log(
    '------------------------------',
  );

  for (
    const row
    of d.rows
  ) {
    console.log(
      `${row.recordKey.padEnd(40)} files=${String(row.fileHitCount).padEnd(3)} blocks=${String(row.balancedBlockHitCount).padEnd(3)} fields=${String(row.currentFieldAssignmentCount).padEnd(3)} parsedValues=${row.parsedCurrentValueCount}`,
    );

    for (
      const value
      of row.parsedCurrentValues
    ) {
      console.log(
        `  VALUE field=${value.fieldName} value=${JSON.stringify(value.parsedValue)} numeric=${JSON.stringify(value.parsedNumericValue)} file=${value.file} record=${value.probeRecordKey}`,
      );
      console.log(
        indent(
          value.context,
          '    ',
        ),
      );
    }

    if (
      row.parsedCurrentValueCount === 0
      && row.currentFieldAssignmentCount > 0
    ) {
      for (
        const field
        of row.allAssignments.filter(
          assignment =>
            row.currentAmmoFieldNames.includes(
              assignment.fieldName,
            ),
        ).slice(0, 8)
      ) {
        console.log(
          `  FIELD field=${field.fieldName} recognized=${field.assignmentRecognized} file=${field.file} record=${field.probeRecordKey}`,
        );
        console.log(
          indent(
            field.context,
            '    ',
          ),
        );
      }
    }
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
      `${name.padEnd(40)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`,
    );
  }

  console.log('');
  console.log(
    'SEMANTIC STATUS',
  );
  console.log(
    '---------------',
  );
  console.log(
    result.semanticStatus,
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

function indent(
  text,
  prefix,
) {
  return String(text)
    .split(/\r?\n/)
    .map(
      line =>
        `${prefix}${line}`,
    )
    .join('\n');
}
