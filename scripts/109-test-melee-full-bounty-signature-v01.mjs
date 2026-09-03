import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';

import {
  createInterface
} from 'node:readline';


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'MELEE_FULL_BOUNTY_SIGNATURE_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// Script106 isolated two economic classes:
//
//   GROUND_ONLY
//
//   GROUND_PLUS_SECOND_COMPONENT
//
// Script108 then showed that the supposed second-component class
// almost never had a usable same-source CItemXP flying-orb link.
//
// Current documented Trooper mechanics provide a specific
// alternative:
//
//   normal non-melee kill
//       -> ground orb + flying orb
//
//   melee kill
//       -> no orbs
//       -> 100% bounty awarded directly
//
// Therefore the Script106 "second component" may not be a second
// reward event at all.
//
// It may be:
//
//   DIRECT_FULL_BOUNTY
//
// This script tests that signature OFFLINE:
//
//   1. Does the full-bounty class usually lack even a candidate
//      Trooper CItemXP episode?
//
//   2. Does the ordinary ground-only class usually HAVE the
//      expected Trooper CItemXP candidate?
//
//   3. Is the credited last-hitter substantially closer to the
//      Trooper at death in the full-bounty class?
//
//   4. Does the observed economic magnitude fit:
//
//        ground-only -> 50% bounty
//        full-bounty -> 100% bounty
//
// IMPORTANT:
//
// This does NOT directly observe the attack input/type.
//
// Even a strong result is:
//
//   MELEE_KILL_SIGNATURE_STRONGLY_SUPPORTED
//
// not:
//
//   MELEE_ATTACK_CANONICALLY_PROVEN
//
// ============================================================


// ============================================================
// INPUT PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT106_PATH =
  resolve(
    'output',
    'cross_replay',
    'reward_mixture_outlier_diagnostic_v02.json'
  );


const SCRIPT108_PATH =
  resolve(
    'output',
    'cross_replay',
    'second_component_source_citemxp_link_validation_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_signature_validation_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'melee_full_bounty_signature_validation_v01.md'
  );


// ============================================================
// TROOPER FLYING-ORB CITEMXP FINGERPRINT
//
// Validated in the discovery replay as the dominant Trooper
// flying-orb subclass.
//
// Cross-replay use remains operational rather than canonical.
// ============================================================

const TROOPER_FLYING_CITEMXP_SUBCLASS =
  '494398941';


// ============================================================
// SOURCE-CANDIDATE WINDOW
//
// Preserve Script108 source-link envelope.
// ============================================================

const SOURCE_MIN_TICK_OFFSET =
  -1;


const SOURCE_MAX_TICK_OFFSET =
  4;


const SOURCE_MAX_DISTANCE_3D_HU =
  250;


// ============================================================
// PROXIMITY DIAGNOSTIC
//
// This is exploratory only.
//
// We search a broad credited-player death-distance threshold to
// quantify whether the full-bounty class carries a strong
// close-range signature.
//
// The best threshold is NOT promoted as a melee range.
// ============================================================

const PROXIMITY_THRESHOLD_MIN_HU =
  0;


const PROXIMITY_THRESHOLD_MAX_HU =
  1000;


const PROXIMITY_THRESHOLD_STEP_HU =
  10;


// ============================================================
// REPLAY SUPPORT THRESHOLDS
//
// Predeclared before Script109 output.
//
// Orb-absence is the primary replay-internal signature.
//
// Credited-player distance is corroborating evidence rather than
// a mandatory mechanic definition.
// ============================================================

const SUPPORT = {

  minimumCases:
    100,

  minimumGroundOnlyCases:
    50,

  minimumFullBountyCases:
    20,

  minimumOrbAbsenceSensitivity:
    0.80,

  minimumOrbPresenceSpecificity:
    0.80,

  minimumOrbAbsenceMCC:
    0.60,

  minimumGroundRewardWithin2Rate:
    0.90,

  minimumFullRewardWithin2Rate:
    0.90
};


// ============================================================
// LOAD GLOBAL INPUTS
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT106_PATH,
    SCRIPT108_PATH
  ]
) {

  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing required input:\n${path}`
    );
  }
}


const manifest =
  JSON.parse(
    readFileSync(
      MANIFEST_PATH,
      'utf8'
    )
  );


const script106 =
  JSON.parse(
    readFileSync(
      SCRIPT106_PATH,
      'utf8'
    )
  );


const script108 =
  JSON.parse(
    readFileSync(
      SCRIPT108_PATH,
      'utf8'
    )
  );


if (
  script106?.status !==
  'POST_JUNE_30_BASELINE_WITH_SECOND_COMPONENT_STRONGLY_SUPPORTED'
) {

  throw new Error(
    `Unexpected Script106 status:\n${script106?.status}`
  );
}


const cohort =
  Array.isArray(
    manifest?.selectedReplicationCohort
  )
    ? manifest.selectedReplicationCohort
    : [];


if (
  cohort.length ===
  0
) {

  throw new Error(
    'No replication cohort.'
  );
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'MELEE / DIRECT FULL-BOUNTY SIGNATURE VALIDATION V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'HYPOTHESIS'
);

console.log(
  '----------'
);


console.log(
  'Script106 GROUND_PLUS_SECOND_COMPONENT may actually be'
);


console.log(
  'DIRECT_FULL_BOUNTY from a melee Trooper kill.'
);


console.log('');

console.log(
  'Primary prediction:'
);


console.log(
  '  full-bounty cases -> Trooper flying CItemXP absent'
);


console.log(
  '  ground-only cases -> Trooper flying CItemXP present'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'No raw .dem parsing.'
);


console.log('');


// ============================================================
// ANALYZE REPLAYS
// ============================================================

const replayResults =
  [];


for (
  let index =
    0;

  index <
    cohort.length;

  index++
) {

  const replayName =
    String(
      cohort[
        index
      ].replayName
    );


  console.log(
    '--------------------------------------------------------'
  );


  console.log(
    `[${index + 1}/${cohort.length}] ${replayName}`
  );


  console.log(
    '--------------------------------------------------------'
  );


  const result =
    await analyzeReplay(
      replayName
    );


  replayResults.push(
    result
  );


  printReplay(
    result
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY STATUS
// ============================================================

const informativeReplays =
  replayResults.filter(
    row =>
      row.support.informative
  );


const signatureSupportedReplays =
  informativeReplays.filter(
    row =>
      row
        .support
        .directFullBountySignatureSupported
  );


let status;


if (
  informativeReplays.length <
  3
) {

  status =
    'INSUFFICIENT_REPLAY_COVERAGE';

} else if (
  signatureSupportedReplays.length >=
  4
) {

  status =
    'MELEE_DIRECT_FULL_BOUNTY_SIGNATURE_STRONGLY_SUPPORTED_ATTACK_TYPE_NOT_DIRECTLY_VALIDATED';

} else if (
  signatureSupportedReplays.length >=
  3
) {

  status =
    'MELEE_DIRECT_FULL_BOUNTY_SIGNATURE_SUPPORTED';

} else {

  status =
    'DIRECT_FULL_BOUNTY_SIGNATURE_NOT_REPLICATED';
}


// ============================================================
// DISTRIBUTIONS
// ============================================================

const distributions = {

  groundOnlyTrooperOrbCandidateRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .orbCandidate
            .groundOnly
            .presenceRate
      )
    ),


  fullBountyTrooperOrbCandidateRate:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .orbCandidate
            .fullBounty
            .presenceRate
      )
    ),


  orbAbsenceMCC:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .orbCandidate
            .absencePredictsFullBounty
            .mcc
      )
    ),


  groundOnlyCreditedDistanceXYMedian:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .creditedDistance
            .groundOnly
            .xy
            .median
      )
    ),


  fullBountyCreditedDistanceXYMedian:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .creditedDistance
            .fullBounty
            .xy
            .median
      )
    ),


  proximityBestThresholdHU:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .creditedDistance
            .exploratoryThreshold
            .best
            ?.thresholdHU
      )
    ),


  proximityBestMCC:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .creditedDistance
            .exploratoryThreshold
            .best
            ?.mcc
      )
    ),


  groundRewardWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .rewardMagnitude
            .groundOnly
            .within2Rate
      )
    ),


  fullRewardWithin2:
    summarizeNumbers(
      replayResults.map(
        row =>
          row
            .rewardMagnitude
            .fullBounty
            .within2Rate
      )
    )
};


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation;


if (
  status ===
  'MELEE_DIRECT_FULL_BOUNTY_SIGNATURE_STRONGLY_SUPPORTED_ATTACK_TYPE_NOT_DIRECTLY_VALIDATED'
) {

  interpretation = {

    resolved:
      false,

    semanticStatus:
      'STRONG_WORKING_IDENTIFICATION',

    conclusion:
      'The Script106 high-reward class reproduces the expected direct-full-bounty/no-orb signature across independent replays. The earlier flying-orb-co-resolution explanation should be rejected.',

    bestWorkingExplanation:
      'Melee Trooper kill awarding the full bounty directly and suppressing ground/flying orb spawning.',

    evidenceChain: [

      'The high-reward class is approximately the full 100% Trooper bounty.',

      'The ordinary class is approximately the 50% ground component.',

      'Trooper flying-orb CItemXP candidates are common in the ordinary class but absent from most full-bounty cases.',

      'Credited-player death distance is evaluated as independent close-range corroboration.'
    ],

    remainingQuestion:
      'Can fatal Trooper damage telemetry directly distinguish melee attacks in these exact full-bounty cases?',

    nextStage:
      'Run one narrowly targeted fatal-damage attack-type validation. If melee attack telemetry aligns with the signature, close Trooper reward-source semantics.'
  };

} else {

  interpretation = {

    resolved:
      false,

    semanticStatus:
      'UNRESOLVED',

    conclusion:
      'The direct-full-bounty/no-orb signature is not sufficiently consistent across independent replays.',

    bestWorkingExplanation:
      null,

    remainingQuestion:
      'Inspect which part of the predicted full-bounty signature failed before parsing new telemetry.',

    nextStage:
      'Do not promote a melee interpretation yet.'
  };
}


// ============================================================
// SUMMARY
// ============================================================

const summary = {

  version:
    VERSION,

  canonical:
    false,

  createdAt:
    new Date().toISOString(),

  status,


  correctionToPriorInterpretation: {

    script106Label:
      'GROUND_PLUS_SECOND_COMPONENT',

    revisedCandidateMeaning:
      'DIRECT_FULL_BOUNTY',

    reason:
      'Script108 showed the putative second-component cases rarely carried the expected same-source flying-orb CItemXP relationship, whereas ordinary ground-only cases usually did.',

    script108Status:
      script108?.status ??
      null
  },


  externalMechanicPrior: {

    claim:
      'A melee Trooper kill suppresses orb spawning and awards the full Trooper bounty directly.',

    role:
      'External prior only; Script109 evaluates whether replay telemetry expresses the corresponding signature.'
  },


  design: {

    replicationUnit:
      'REPLAY',

    rawReplayParsing:
      false,

    trooperCItemXPSubclass:
      TROOPER_FLYING_CITEMXP_SUBCLASS,

    sourceCandidate: {

      tickOffsetMinimum:
        SOURCE_MIN_TICK_OFFSET,

      tickOffsetMaximum:
        SOURCE_MAX_TICK_OFFSET,

      maximum3DDistanceHU:
        SOURCE_MAX_DISTANCE_3D_HU
    },

    proximity:
      'Credited-player distance is corroborating/exploratory and is not treated as an exact melee-range estimate.',

    attackType:
      'Not directly measured in this script.'
  },


  supportThresholds:
    SUPPORT,


  replayCounts: {

    total:
      replayResults.length,

    informative:
      informativeReplays.length,

    signatureSupported:
      signatureSupportedReplays.length
  },


  distributions,

  replays:
    replayResults,

  interpretation,


  outputs: {

    json:
      OUTPUT_JSON_PATH,

    markdown:
      OUTPUT_MARKDOWN_PATH
  }
};


// ============================================================
// WRITE
// ============================================================

mkdirSync(
  dirname(
    OUTPUT_JSON_PATH
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  OUTPUT_JSON_PATH,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  OUTPUT_MARKDOWN_PATH,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// FINAL CONSOLE
// ============================================================

console.log(
  '========================================================'
);

console.log(
  'CROSS-REPLAY FULL-BOUNTY SIGNATURE SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'REPLAY SUPPORT'
);

console.log(
  '--------------'
);


for (
  const row
  of replayResults
) {

  console.log(

    `${row.replay.padEnd(12)} ` +

    `orbMCC=${formatNumber(
      row
        .orbCandidate
        .absencePredictsFullBounty
        .mcc
    ).padEnd(7)} ` +

    `nearMCC=${formatNumber(
      row
        .creditedDistance
        .exploratoryThreshold
        .best
        ?.mcc
    ).padEnd(7)} ` +

    `support=${row.support.directFullBountySignatureSupported}`
  );
}


console.log('');

console.log(
  'KEY DISTRIBUTIONS'
);

console.log(
  '-----------------'
);


console.log(
  `Ground-only orb presence: ${formatDistribution(
    distributions.groundOnlyTrooperOrbCandidateRate
  )}`
);


console.log(
  `Full-bounty orb presence:  ${formatDistribution(
    distributions.fullBountyTrooperOrbCandidateRate
  )}`
);


console.log(
  `Orb-absence MCC:           ${formatDistribution(
    distributions.orbAbsenceMCC
  )}`
);


console.log(
  `Ground credited XY:        ${formatDistribution(
    distributions.groundOnlyCreditedDistanceXYMedian
  )}`
);


console.log(
  `Full credited XY:          ${formatDistribution(
    distributions.fullBountyCreditedDistanceXYMedian
  )}`
);


console.log(
  `Best proximity threshold:  ${formatDistribution(
    distributions.proximityBestThresholdHU
  )}`
);


console.log(
  `Best proximity MCC:        ${formatDistribution(
    distributions.proximityBestMCC
  )}`
);


console.log(
  `Ground reward <=2:         ${formatDistribution(
    distributions.groundRewardWithin2
  )}`
);


console.log(
  `Full reward <=2:           ${formatDistribution(
    distributions.fullRewardWithin2
  )}`
);


console.log('');

console.log(
  'STATUS'
);

console.log(
  '------'
);


console.log(
  status
);


console.log('');

console.log(
  'INTERPRETATION'
);

console.log(
  '--------------'
);


console.log(
  interpretation.conclusion
);


console.log('');

console.log(
  `JSON:\n${OUTPUT_JSON_PATH}`
);


console.log('');

console.log(
  `Markdown:\n${OUTPUT_MARKDOWN_PATH}`
);


console.log('');


// ============================================================
// ANALYZE REPLAY
// ============================================================

async function analyzeReplay(
  replayName
) {

  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const casesPath =
    resolve(
      outputDirectory,
      'second_component_source_citemxp_cases_v01.jsonl'
    );


  const deathsPath =
    resolve(
      outputDirectory,
      'replication_trooper_deaths_v01.jsonl'
    );


  const episodesPath =
    resolve(
      outputDirectory,
      'replication_citemxp_source_episodes_v01.jsonl'
    );


  for (
    const path
    of [
      casesPath,
      deathsPath,
      episodesPath
    ]
  ) {

    if (
      !existsSync(
        path
      )
    ) {

      throw new Error(
        `Missing ${replayName} input:\n${path}`
      );
    }
  }


  const cases =
    await loadJsonl(
      casesPath
    );


  const deaths =
    await loadJsonl(
      deathsPath
    );


  const episodes =
    await loadJsonl(
      episodesPath
    );


  const deathsById =
    new Map(
      deaths.map(
        death => [

          makeDeathId(
            death
          ),

          death
        ]
      )
    );


  const episodesByStartTick =
    groupBy(
      episodes,
      row =>
        Number(
          row.startTick
        )
    );


  const enriched =
    [];


  for (
    const row
    of cases
  ) {

    const death =
      deathsById.get(
        String(
          row.deathId
        )
      )
      ??
      null;


    const candidateSummary =
      findCItemXPCandidates({

        row,

        death,

        episodesByStartTick
      });


    const creditedDistance =
      findCreditedDeathDistance(
        row,
        death
      );


    const groundResidual =
      Number.isFinite(
        row.predictedGround
      )
        ? row.teamTotal -
          row.predictedGround
        : null;


    const fullResidual =
      Number.isFinite(
        row.predictedCombined
      )
        ? row.teamTotal -
          row.predictedCombined
        : null;


    enriched.push({

      ...row,

      sourceStrictLinkPresent:
        Boolean(
          row.sourceLink
        ),

      anyCItemXPCandidate:
        candidateSummary.anyCandidate,

      trooperCItemXPCandidate:
        candidateSummary.trooperCandidate,

      candidateCounts:
        candidateSummary.counts,

      nearestCandidate:
        candidateSummary.nearest,

      creditedDistance,

      groundResidual,

      fullResidual
    });
  }


  const groundOnly =
    enriched.filter(
      row =>
        row.componentClass ===
        'GROUND_ONLY'
    );


  const fullBounty =
    enriched.filter(
      row =>
        row.componentClass ===
        'GROUND_PLUS_SECOND_COMPONENT'
    );


  // ----------------------------------------------------------
  // CITEMXP CANDIDATE PRESENCE
  // ----------------------------------------------------------

  const groundWithTrooperCandidate =
    groundOnly.filter(
      row =>
        row.trooperCItemXPCandidate
    ).length;


  const fullWithTrooperCandidate =
    fullBounty.filter(
      row =>
        row.trooperCItemXPCandidate
    ).length;


  const candidateAssociation =
    binaryAssociation(

      enriched.map(
        row => ({

          actualPositive:
            row.componentClass ===
            'GROUND_PLUS_SECOND_COMPONENT',

          predictedPositive:
            !row.trooperCItemXPCandidate
        })
      )
    );


  const strictLinkAssociation =
    binaryAssociation(

      enriched.map(
        row => ({

          actualPositive:
            row.componentClass ===
            'GROUND_PLUS_SECOND_COMPONENT',

          predictedPositive:
            !row.sourceStrictLinkPresent
        })
      )
    );


  const orbCandidate = {

    groundOnly: {

      cases:
        groundOnly.length,

      present:
        groundWithTrooperCandidate,

      absent:
        groundOnly.length -
        groundWithTrooperCandidate,

      presenceRate:
        rate(
          groundWithTrooperCandidate,
          groundOnly.length
        )
    },


    fullBounty: {

      cases:
        fullBounty.length,

      present:
        fullWithTrooperCandidate,

      absent:
        fullBounty.length -
        fullWithTrooperCandidate,

      presenceRate:
        rate(
          fullWithTrooperCandidate,
          fullBounty.length
        )
    },


    absencePredictsFullBounty:
      candidateAssociation,


    strictSourceLinkAbsencePredictsFullBounty:
      strictLinkAssociation
  };


  // ----------------------------------------------------------
  // CREDITED PLAYER DISTANCE
  // ----------------------------------------------------------

  const groundXY =
    groundOnly
      .map(
        row =>
          row
            ?.creditedDistance
            ?.xy
      )
      .filter(
        Number.isFinite
      );


  const fullXY =
    fullBounty
      .map(
        row =>
          row
            ?.creditedDistance
            ?.xy
      )
      .filter(
        Number.isFinite
      );


  const ground3D =
    groundOnly
      .map(
        row =>
          row
            ?.creditedDistance
            ?.threeD
      )
      .filter(
        Number.isFinite
      );


  const full3D =
    fullBounty
      .map(
        row =>
          row
            ?.creditedDistance
            ?.threeD
      )
      .filter(
        Number.isFinite
      );


  const proximityObservations =
    enriched
      .filter(
        row =>
          Number.isFinite(
            row
              ?.creditedDistance
              ?.xy
          )
      )
      .map(
        row => ({

          actualPositive:
            row.componentClass ===
            'GROUND_PLUS_SECOND_COMPONENT',

          distance:
            row.creditedDistance.xy
        })
      );


  const proximityThresholds =
    [];


  for (
    let threshold =
      PROXIMITY_THRESHOLD_MIN_HU;

    threshold <=
      PROXIMITY_THRESHOLD_MAX_HU;

    threshold +=
      PROXIMITY_THRESHOLD_STEP_HU
  ) {

    proximityThresholds.push(
      evaluateDistanceThreshold(
        proximityObservations,
        threshold
      )
    );
  }


  proximityThresholds.sort(
    (
      a,
      b
    ) =>
      compareMetricDescending(
        a.mcc,
        b.mcc
      )
      ||
      compareMetricDescending(
        a.accuracy,
        b.accuracy
      )
      ||
      a.thresholdHU -
      b.thresholdHU
  );


  const creditedDistance = {

    coverage: {

      all:
        proximityObservations.length,

      total:
        enriched.length,

      rate:
        rate(
          proximityObservations.length,
          enriched.length
        )
    },


    groundOnly: {

      xy:
        summarizeNumbers(
          groundXY
        ),

      threeD:
        summarizeNumbers(
          ground3D
        )
    },


    fullBounty: {

      xy:
        summarizeNumbers(
          fullXY
        ),

      threeD:
        summarizeNumbers(
          full3D
        )
    },


    exploratoryThreshold: {

      best:
        proximityThresholds[0]
        ??
        null,

      note:
        'Exploratory discriminator only; not an inferred engine melee range.'
    }
  };


  // ----------------------------------------------------------
  // REWARD MAGNITUDE
  // ----------------------------------------------------------

  const groundResiduals =
    groundOnly
      .map(
        row =>
          row.groundResidual
      )
      .filter(
        Number.isFinite
      );


  const fullResiduals =
    fullBounty
      .map(
        row =>
          row.fullResidual
      )
      .filter(
        Number.isFinite
      );


  const rewardMagnitude = {

    groundOnly:
      residualMetrics(
        groundResiduals
      ),

    fullBounty:
      residualMetrics(
        fullResiduals
      )
  };


  // ----------------------------------------------------------
  // SUPPORT
  // ----------------------------------------------------------

  const informative =

    enriched.length >=
      SUPPORT.minimumCases

    &&

    groundOnly.length >=
      SUPPORT.minimumGroundOnlyCases

    &&

    fullBounty.length >=
      SUPPORT.minimumFullBountyCases;


  const directFullBountySignatureSupported =

    informative

    &&

    (
      candidateAssociation.sensitivity ??
      0
    ) >=
      SUPPORT.minimumOrbAbsenceSensitivity

    &&

    (
      candidateAssociation.specificity ??
      0
    ) >=
      SUPPORT.minimumOrbPresenceSpecificity

    &&

    (
      candidateAssociation.mcc ??
      -1
    ) >=
      SUPPORT.minimumOrbAbsenceMCC

    &&

    (
      rewardMagnitude
        .groundOnly
        .within2Rate ??
      0
    ) >=
      SUPPORT.minimumGroundRewardWithin2Rate

    &&

    (
      rewardMagnitude
        .fullBounty
        .within2Rate ??
      0
    ) >=
      SUPPORT.minimumFullRewardWithin2Rate;


  const support = {

    informative,

    directFullBountySignatureSupported,


    criteria: {

      cases:
        enriched.length,

      groundOnlyCases:
        groundOnly.length,

      fullBountyCases:
        fullBounty.length,

      orbAbsenceSensitivity:
        candidateAssociation.sensitivity,

      orbPresenceSpecificity:
        candidateAssociation.specificity,

      orbAbsenceMCC:
        candidateAssociation.mcc,

      groundRewardWithin2Rate:
        rewardMagnitude
          .groundOnly
          .within2Rate,

      fullRewardWithin2Rate:
        rewardMagnitude
          .fullBounty
          .within2Rate,

      creditedDistanceCoverage:
        creditedDistance
          .coverage
          .rate,

      exploratoryProximityMCC:
        creditedDistance
          .exploratoryThreshold
          .best
          ?.mcc
        ??
        null
    }
  };


  return {

    replay:
      replayName,

    version:
      VERSION,

    canonical:
      false,


    counts: {

      total:
        enriched.length,

      groundOnly:
        groundOnly.length,

      fullBounty:
        fullBounty.length
    },


    orbCandidate,

    creditedDistance,

    rewardMagnitude,

    support
  };
}


// ============================================================
// FIND CITEMXP CANDIDATES
// ============================================================

function findCItemXPCandidates({

  row,

  death,

  episodesByStartTick
}) {

  if (
    !death
    ||
    !row.deathPosition
  ) {

    return {

      anyCandidate:
        false,

      trooperCandidate:
        false,

      counts: {

        all:
          0,

        trooperSubclass:
          0
      },

      nearest:
        null
    };
  }


  const candidates =
    [];


  for (
    let tick =
      Number(
        row.deathTick
      )
      +
      SOURCE_MIN_TICK_OFFSET;

    tick <=
      Number(
        row.deathTick
      )
      +
      SOURCE_MAX_TICK_OFFSET;

    tick++
  ) {

    for (
      const episode
      of episodesByStartTick.get(
        tick
      )
      ??
      []
    ) {

      if (
        !episode.startPosition
      ) {

        continue;
      }


      const knownDeathTeam =
        isGameTeam(
          Number(
            row.deathTeam
          )
        );


      const knownEpisodeTeam =
        isGameTeam(
          Number(
            episode.team
          )
        );


      if (
        knownDeathTeam
        &&
        knownEpisodeTeam
        &&
        Number(
          episode.team
        ) !==
        Number(
          row.deathTeam
        )
      ) {

        continue;
      }


      const distance3d =
        distance3D(
          row.deathPosition,
          episode.startPosition
        );


      if (
        distance3d >
        SOURCE_MAX_DISTANCE_3D_HU
      ) {

        continue;
      }


      candidates.push({

        episodeId:
          episode.episodeId,

        subclassId:
          String(
            episode.subclassId
          ),

        startTick:
          episode.startTick,

        tickDelta:
          episode.startTick -
          row.deathTick,

        distanceXY:
          distanceXY(
            row.deathPosition,
            episode.startPosition
          ),

        distance3D:
          distance3d
      });
    }
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      a.distance3D -
      b.distance3D
      ||
      Math.abs(
        a.tickDelta
      )
      -
      Math.abs(
        b.tickDelta
      )
  );


  const trooperCandidates =
    candidates.filter(
      row =>
        row.subclassId ===
        TROOPER_FLYING_CITEMXP_SUBCLASS
    );


  return {

    anyCandidate:
      candidates.length >
      0,

    trooperCandidate:
      trooperCandidates.length >
      0,

    counts: {

      all:
        candidates.length,

      trooperSubclass:
        trooperCandidates.length
    },

    nearest:
      trooperCandidates[0]
      ??
      candidates[0]
      ??
      null
  };
}


// ============================================================
// CREDITED PLAYER DISTANCE
// ============================================================

function findCreditedDeathDistance(
  row,
  death
) {

  if (
    !death
    ||
    !row.deathPosition
    ||
    !row.creditedName
  ) {

    return null;
  }


  const players =
    Array.isArray(
      death.playersAtDeath
    )
      ? death.playersAtDeath
      : [];


  const player =
    players.find(
      candidate =>
        candidate.playerName ===
        row.creditedName
    )
    ??
    null;


  if (
    !player
  ) {

    return null;
  }


  const position =
    normalizePosition(

      player.position

      ??

      player.pawnPosition

      ??

      player.positionWorld

      ??

      player.pawn?.position

      ??

      null
    );


  if (
    !position
  ) {

    return null;
  }


  return {

    xy:
      distanceXY(
        position,
        row.deathPosition
      ),

    threeD:
      distance3D(
        position,
        row.deathPosition
      )
  };
}


// ============================================================
// DISTANCE THRESHOLD
// ============================================================

function evaluateDistanceThreshold(
  rows,
  threshold
) {

  return binaryAssociation(

    rows.map(
      row => ({

        actualPositive:
          row.actualPositive,

        predictedPositive:
          row.distance <=
          threshold
      })
    ),

    threshold
  );
}


// ============================================================
// BINARY ASSOCIATION
// ============================================================

function binaryAssociation(
  rows,
  thresholdHU = null
) {

  let tp =
    0;


  let tn =
    0;


  let fp =
    0;


  let fn =
    0;


  for (
    const row
    of rows
  ) {

    if (
      row.actualPositive
      &&
      row.predictedPositive
    ) {

      tp++;

    } else if (
      row.actualPositive
      &&
      !row.predictedPositive
    ) {

      fn++;

    } else if (
      !row.actualPositive
      &&
      row.predictedPositive
    ) {

      fp++;

    } else {

      tn++;
    }
  }


  return {

    thresholdHU,

    tp,

    tn,

    fp,

    fn,

    sensitivity:
      safeDivide(
        tp,
        tp +
        fn
      ),

    specificity:
      safeDivide(
        tn,
        tn +
        fp
      ),

    accuracy:
      safeDivide(
        tp +
        tn,
        tp +
        tn +
        fp +
        fn
      ),

    mcc:
      matthewsCorrelation(
        tp,
        tn,
        fp,
        fn
      )
  };
}


// ============================================================
// RESIDUAL METRICS
// ============================================================

function residualMetrics(
  residuals
) {

  const clean =
    residuals.filter(
      Number.isFinite
    );


  const absolute =
    clean.map(
      Math.abs
    );


  return {

    count:
      clean.length,

    residual:
      summarizeNumbers(
        clean
      ),

    absoluteError:
      summarizeNumbers(
        absolute
      ),

    exactRate:
      rate(

        absolute.filter(
          value =>
            value <
            1e-9
        ).length,

        absolute.length
      ),

    within1Rate:
      rate(

        absolute.filter(
          value =>
            value <=
            1
        ).length,

        absolute.length
      ),

    within2Rate:
      rate(

        absolute.filter(
          value =>
            value <=
            2
        ).length,

        absolute.length
      )
  };
}


// ============================================================
// DEATH ID
// ============================================================

function makeDeathId(
  death
) {

  return String(

    death.deathIndex

    ??

    `${death.entityIndex}|${death.tick}`
  );
}


// ============================================================
// TEAM
// ============================================================

function isGameTeam(
  team
) {

  return team ===
    2
    ||
    team ===
    3;
}


// ============================================================
// POSITION
// ============================================================

function normalizePosition(
  value
) {

  if (
    !value
  ) {

    return null;
  }


  const x =
    finite(
      value.x
      ??
      value[0]
    );


  const y =
    finite(
      value.y
      ??
      value[1]
    );


  const z =
    finite(
      value.z
      ??
      value[2]
    );


  if (
    x ===
      null
    ||
    y ===
      null
  ) {

    return null;
  }


  return {

    x,

    y,

    z
  };
}


// ============================================================
// DISTANCE
// ============================================================

function distanceXY(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return Infinity;
  }


  return Math.sqrt(

    (
      a.x -
      b.x
    )
    ** 2

    +

    (
      a.y -
      b.y
    )
    ** 2
  );
}


function distance3D(
  a,
  b
) {

  if (
    !a
    ||
    !b
  ) {

    return Infinity;
  }


  const dz =
    Number.isFinite(
      a.z
    )
    &&
    Number.isFinite(
      b.z
    )
      ? a.z -
        b.z
      : 0;


  return Math.sqrt(

    (
      a.x -
      b.x
    )
    ** 2

    +

    (
      a.y -
      b.y
    )
    ** 2

    +

    dz
    ** 2
  );
}


// ============================================================
// MCC
// ============================================================

function matthewsCorrelation(
  tp,
  tn,
  fp,
  fn
) {

  const denominator =
    Math.sqrt(

      (
        tp +
        fp
      )

      *

      (
        tp +
        fn
      )

      *

      (
        tn +
        fp
      )

      *

      (
        tn +
        fn
      )
    );


  if (
    denominator ===
    0
  ) {

    return null;
  }


  return (
    tp *
    tn
    -
    fp *
    fn
  )
  /
  denominator;
}


// ============================================================
// COLLECTION
// ============================================================

function groupBy(
  rows,
  selector
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      selector(
        row
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        []
      );
    }


    map.get(
      key
    ).push(
      row
    );
  }


  return map;
}


// ============================================================
// JSONL
// ============================================================

async function loadJsonl(
  path
) {

  const rows =
    [];


  const reader =
    createInterface({

      input:
        createReadStream(
          path,
          {
            encoding:
              'utf8'
          }
        ),

      crlfDelay:
        Infinity
    });


  for await (
    const line
    of reader
  ) {

    if (
      !line.trim()
    ) {

      continue;
    }


    try {

      rows.push(
        JSON.parse(
          line
        )
      );

    } catch {}
  }


  return rows;
}


// ============================================================
// NUMBER
// ============================================================

function finite(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
    ||
    value ===
      ''
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function rate(
  numerator,
  denominator
) {

  if (
    !Number.isFinite(
      numerator
    )
    ||
    !Number.isFinite(
      denominator
    )
    ||
    denominator <=
      0
  ) {

    return null;
  }


  return numerator /
    denominator;
}


function safeDivide(
  numerator,
  denominator
) {

  return denominator >
    0
      ? numerator /
        denominator
      : null;
}


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    clean.length ===
      0
  ) {

    return null;
  }


  return clean.reduce(
    (
      sum,
      value
    ) =>
      sum +
      value,
    0
  )
  /
  clean.length;
}


function compareMetricDescending(
  a,
  b
) {

  const aa =
    Number.isFinite(
      a
    )
      ? a
      : -Infinity;


  const bb =
    Number.isFinite(
      b
    )
      ? b
      : -Infinity;


  return bb -
    aa;
}


// ============================================================
// DISTRIBUTIONS
// ============================================================

function summarizeNumbers(
  source
) {

  const clean =
    source
      .filter(
        Number.isFinite
      )
      .sort(
        (
          a,
          b
        ) =>
          a -
          b
      );


  if (
    clean.length ===
      0
  ) {

    return {

      count:
        0,

      min:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p95:
        null,

      max:
        null,

      mean:
        null
    };
  }


  return {

    count:
      clean.length,

    min:
      clean[0],

    p25:
      quantile(
        clean,
        0.25
      ),

    median:
      quantile(
        clean,
        0.50
      ),

    p75:
      quantile(
        clean,
        0.75
      ),

    p95:
      quantile(
        clean,
        0.95
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      mean(
        clean
      )
  };
}


function quantile(
  sorted,
  q
) {

  if (
    sorted.length ===
    1
  ) {

    return sorted[0];
  }


  const position =
    (
      sorted.length -
      1
    )
    *
    q;


  const lower =
    Math.floor(
      position
    );


  const upper =
    Math.ceil(
      position
    );


  if (
    lower ===
      upper
  ) {

    return sorted[
      lower
    ];
  }


  const weight =
    position -
    lower;


  return (
    sorted[
      lower
    ]
    *
    (
      1 -
      weight
    )

    +

    sorted[
      upper
    ]
    *
    weight
  );
}


// ============================================================
// CONSOLE
// ============================================================

function printReplay(
  row
) {

  console.log('');

  console.log(
    'CASES'
  );


  console.log(
    `  ground-only:              ${row.counts.groundOnly}`
  );


  console.log(
    `  full-bounty candidate:    ${row.counts.fullBounty}`
  );


  console.log('');

  console.log(
    'TROOPER FLYING CITEMXP'
  );


  console.log(
    `  ground-only present:      ${row.orbCandidate.groundOnly.present}/${row.orbCandidate.groundOnly.cases} (${formatPercent(
      row.orbCandidate.groundOnly.presenceRate
    )})`
  );


  console.log(
    `  full-bounty present:      ${row.orbCandidate.fullBounty.present}/${row.orbCandidate.fullBounty.cases} (${formatPercent(
      row.orbCandidate.fullBounty.presenceRate
    )})`
  );


  console.log(
    `  absence sensitivity:      ${formatPercent(
      row.orbCandidate.absencePredictsFullBounty.sensitivity
    )}`
  );


  console.log(
    `  presence specificity:     ${formatPercent(
      row.orbCandidate.absencePredictsFullBounty.specificity
    )}`
  );


  console.log(
    `  absence MCC:              ${formatNumber(
      row.orbCandidate.absencePredictsFullBounty.mcc
    )}`
  );


  console.log('');

  console.log(
    'CREDITED PLAYER DISTANCE'
  );


  console.log(
    `  ground XY median:         ${formatNumber(
      row.creditedDistance.groundOnly.xy.median
    )} HU`
  );


  console.log(
    `  full-bounty XY median:    ${formatNumber(
      row.creditedDistance.fullBounty.xy.median
    )} HU`
  );


  console.log(
    `  exploratory best cutoff:  ${formatNumber(
      row.creditedDistance.exploratoryThreshold.best?.thresholdHU
    )} HU`
  );


  console.log(
    `  exploratory proximity MCC:${formatNumber(
      row.creditedDistance.exploratoryThreshold.best?.mcc
    )}`
  );


  console.log('');

  console.log(
    'REWARD MAGNITUDE'
  );


  console.log(
    `  ground 50% model <=2:     ${formatPercent(
      row.rewardMagnitude.groundOnly.within2Rate
    )}`
  );


  console.log(
    `  full 100% model <=2:      ${formatPercent(
      row.rewardMagnitude.fullBounty.within2Rate
    )}`
  );


  console.log('');

  console.log(
    'SUPPORT'
  );


  console.log(
    `  informative:              ${row.support.informative}`
  );


  console.log(
    `  full-bounty signature:    ${row.support.directFullBountySignatureSupported}`
  );
}


// ============================================================
// FORMAT
// ============================================================

function formatNumber(
  value
) {

  return Number.isFinite(
    value
  )
    ? Number(
        value.toFixed(
          4
        )
      ).toString()
    : 'n/a';
}


function formatPercent(
  value
) {

  return Number.isFinite(
    value
  )
    ? `${(
        value *
        100
      ).toFixed(
        2
      )}%`
    : 'n/a';
}


function formatDistribution(
  row
) {

  if (
    !row
    ||
    row.count ===
      0
  ) {

    return 'n=0';
  }


  return (
    `n=${row.count} ` +
    `min=${formatNumber(row.min)} ` +
    `p25=${formatNumber(row.p25)} ` +
    `median=${formatNumber(row.median)} ` +
    `p75=${formatNumber(row.p75)} ` +
    `max=${formatNumber(row.max)}`
  );
}


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Melee / Direct Full-Bounty Signature Validation'
  );


  lines.push(
    ''
  );


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push(
    ''
  );


  lines.push(
    '## Working hypothesis'
  );


  lines.push(
    ''
  );


  lines.push(
    'The Script106 `GROUND_PLUS_SECOND_COMPONENT` class may instead represent direct 100% Trooper bounty awards from melee kills, which suppress normal ground/flying orb spawning.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Replay results'
  );


  lines.push(
    ''
  );


  for (
    const replay
    of summary.replays
  ) {

    lines.push(
      `### ${replay.replay}`
    );


    lines.push(
      ''
    );


    lines.push(
      `- Ground-only cases: ${replay.counts.groundOnly}`
    );


    lines.push(
      `- Full-bounty candidate cases: ${replay.counts.fullBounty}`
    );


    lines.push(
      `- Trooper CItemXP presence in ground-only: ${formatPercent(replay.orbCandidate.groundOnly.presenceRate)}`
    );


    lines.push(
      `- Trooper CItemXP presence in full-bounty class: ${formatPercent(replay.orbCandidate.fullBounty.presenceRate)}`
    );


    lines.push(
      `- Orb-absence MCC: ${formatNumber(replay.orbCandidate.absencePredictsFullBounty.mcc)}`
    );


    lines.push(
      `- Ground-only credited-player XY median: ${formatNumber(replay.creditedDistance.groundOnly.xy.median)} HU`
    );


    lines.push(
      `- Full-bounty credited-player XY median: ${formatNumber(replay.creditedDistance.fullBounty.xy.median)} HU`
    );


    lines.push(
      `- Ground 50% model within ±2: ${formatPercent(replay.rewardMagnitude.groundOnly.within2Rate)}`
    );


    lines.push(
      `- Full 100% model within ±2: ${formatPercent(replay.rewardMagnitude.fullBounty.within2Rate)}`
    );


    lines.push(
      `- Signature supported: **${replay.support.directFullBountySignatureSupported}**`
    );


    lines.push(
      ''
    );
  }


  lines.push(
    '## Interpretation'
  );


  lines.push(
    ''
  );


  lines.push(
    summary.interpretation.conclusion
  );


  lines.push(
    ''
  );


  lines.push(
    `Remaining question: ${summary.interpretation.remainingQuestion}`
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}