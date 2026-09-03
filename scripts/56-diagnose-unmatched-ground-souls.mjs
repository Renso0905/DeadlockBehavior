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
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'test';

const TICK_RATE =
  64;


// ============================================================
// VERIFIED MELEE ASSOCIATION
//
// Script 16 does NOT identify the target entity for each melee
// attack. Its trustworthy direct fields are instead:
//
//   hit
//   hitObservedTick
//   hitObservedMatchTimeSeconds
//   hitPosition
//   playerName
//   team
//   attackType
//
// hitPosition is the attacker's position when the direct
// HoldMelee ability first reports m_bHitWithThisAttack=true.
//
// Therefore this script tests SPATIOTEMPORAL ASSOCIATION only.
// It never calls a melee event target-attributed.
// ============================================================

const CORE_MELEE_WINDOW_SECONDS =
  0.250;

const CORE_MELEE_DISTANCE_HU =
  300;

const MELEE_WINDOWS_SECONDS = [
  0.0625,
  0.125,
  0.250,
  0.500,
  0.750,
  1.000
];

const MELEE_DISTANCE_THRESHOLDS_HU = [
  100,
  150,
  200,
  250,
  300,
  400,
  500,
  750
];

const MAX_MELEE_SEARCH_SECONDS =
  Math.max(
    ...MELEE_WINDOWS_SECONDS
  );


// ============================================================
// PLAYER PROXIMITY
// ============================================================

const PLAYER_DISTANCE_THRESHOLDS = [
  250,
  500,
  750,
  1000,
  1250,
  1500,
  1750,
  1771.65,
  1800,
  2000,
  2250,
  2500,
  3000
];

const PLAYER_STATE_BUCKET_HZ =
  4;

const PLAYER_STATE_SEARCH_BUCKETS =
  2;

const MAX_EXAMPLES_PER_GROUP =
  100;


// ============================================================
// PATHS
// ============================================================

const deathStreamPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_one_to_one_v01.jsonl'
  );

const meleePath =
  resolve(
    'output',
    replayName,
    'verified_melee_events.jsonl'
  );

const meleeSummaryPath =
  resolve(
    'output',
    replayName,
    'melee_verification_summary.json'
  );

const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );

const outputPath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_unmatched_diagnostic_v02.json'
  );

const outputCandidatePath =
  resolve(
    'output',
    replayName,
    'trooper_ground_soul_melee_candidates_v02.jsonl'
  );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
  const path
  of [
    deathStreamPath,
    meleePath,
    meleeSummaryPath,
    playerStatePath
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


// ============================================================
// LOAD TROOPER DEATH STREAM
// ============================================================

console.log('');
console.log(
  'Loading one-to-one Trooper death stream...'
);

const rawDeaths =
  await loadJsonl(
    deathStreamPath
  );

const deaths =
  rawDeaths
    .map(
      normalizeDeath
    )
    .filter(
      Boolean
    );

console.log(
  `Eligible economic Trooper deaths: ${deaths.length}`
);


// ============================================================
// LOAD SCRIPT 16 VERIFIED MELEE
// ============================================================

console.log(
  'Loading Script 16 verified melee events...'
);

const meleeSummary =
  JSON.parse(
    readFileSync(
      meleeSummaryPath,
      'utf8'
    )
  );

const rawMelee =
  await loadJsonl(
    meleePath
  );

const melee =
  rawMelee
    .map(
      (
        row,
        index
      ) =>
        normalizeVerifiedMelee(
          row,
          index
        )
    )
    .filter(
      Boolean
    );

const confirmedHits =
  melee
    .filter(
      row =>
        row.hit ===
          true
        &&
        Number.isFinite(
          row.hitTimeSeconds
        )
        &&
        row.hitPosition
    )
    .sort(
      (
        a,
        b
      ) =>
        a.hitTimeSeconds -
        b.hitTimeSeconds
        ||
        a.meleeIndex -
        b.meleeIndex
    );

console.log(
  `Raw Script 16 melee rows: ${rawMelee.length}`
);

console.log(
  `Normalized Script 16 melee rows: ${melee.length}`
);

console.log(
  `Confirmed hits with direct time + position: ${confirmedHits.length}`
);


// ============================================================
// LOAD PLAYER STATE BUCKETS
// ============================================================

console.log(
  'Loading player-state proximity buckets...'
);

const playerBuckets =
  new Map();

let playerRows =
  0;

let usablePlayerRows =
  0;

const playerReader =
  createInterface({
    input:
      createReadStream(
        playerStatePath,
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
  of playerReader
) {
  if (
    !line.trim()
  ) {
    continue;
  }

  playerRows++;

  let row;

  try {
    row =
      JSON.parse(
        line
      );
  } catch {
    continue;
  }

  const timeSeconds =
    finite(
      row
        ?.matchTimeSeconds
    );

  const team =
    finite(
      row
        ?.controller
        ?.team
    );

  const playerName =
    row
      ?.controller
      ?.playerName ??
    null;

  const pawnEntityIndex =
    finite(
      row
        ?.pawn
        ?.entityIndex
    );

  const alive =
    row
      ?.controller
      ?.alive ===
    true;

  const movementValid =
    row
      ?.pawn
      ?.positionValidForMovement ===
    true;

  const position =
    normalizePosition(
      row
        ?.pawn
        ?.positionWorld
    );

  if (
    timeSeconds ===
      null
    ||
    team ===
      null
    ||
    !playerName
    ||
    pawnEntityIndex ===
      null
    ||
    !alive
    ||
    !movementValid
    ||
    !position
  ) {
    continue;
  }

  usablePlayerRows++;

  const bucket =
    Math.round(
      timeSeconds *
      PLAYER_STATE_BUCKET_HZ
    );

  if (
    !playerBuckets.has(
      bucket
    )
  ) {
    playerBuckets.set(
      bucket,
      []
    );
  }

  playerBuckets
    .get(
      bucket
    )
    .push({
      timeSeconds,
      team,
      playerName,
      pawnEntityIndex,
      position
    });
}

console.log(
  `Player-state rows: ${playerRows}`
);

console.log(
  `Usable spatial player rows: ${usablePlayerRows}`
);


// ============================================================
// ENRICH DEATHS
// ============================================================

console.log(
  'Associating verified melee hits and opposing-player geometry...'
);

for (
  const death
  of deaths
) {
  death.verifiedMeleeHitsWithin1s =
    findNearbyVerifiedMeleeHits(
      death
    );

  death.nearestVerifiedMeleeHit =
    death
      .verifiedMeleeHitsWithin1s[0] ??
    null;

  death.coreMeleeAssociation =
    death
      .verifiedMeleeHitsWithin1s
      .find(
        candidate =>
          candidate.absoluteTimeDeltaSeconds <=
            CORE_MELEE_WINDOW_SECONDS
          &&
          candidate.distance3D <=
            CORE_MELEE_DISTANCE_HU
      ) ??
    null;

  death.playerProximity =
    findOpposingPlayerProximity(
      death
    );
}


// ============================================================
// PARTITION
// ============================================================

const matched =
  deaths.filter(
    row =>
      row.groundSoulMatched
  );

const unmatched =
  deaths.filter(
    row =>
      !row.groundSoulMatched
  );


// ============================================================
// VERIFIED MELEE SENSITIVITY MATRIX
// ============================================================

const meleeAssociationMatrix =
  [];

for (
  const windowSeconds
  of MELEE_WINDOWS_SECONDS
) {
  for (
    const distanceHu
    of MELEE_DISTANCE_THRESHOLDS_HU
  ) {
    const matchedAssociated =
      matched.filter(
        row =>
          hasVerifiedMeleeAssociation(
            row,
            windowSeconds,
            distanceHu
          )
      ).length;

    const unmatchedAssociated =
      unmatched.filter(
        row =>
          hasVerifiedMeleeAssociation(
            row,
            windowSeconds,
            distanceHu
          )
      ).length;

    const matchedRate =
      rate(
        matchedAssociated,
        matched.length
      );

    const unmatchedRate =
      rate(
        unmatchedAssociated,
        unmatched.length
      );

    meleeAssociationMatrix.push({
      windowSeconds,
      distanceHu,

      matched: {
        associated:
          matchedAssociated,
        total:
          matched.length,
        rate:
          matchedRate
      },

      unmatched: {
        associated:
          unmatchedAssociated,
        total:
          unmatched.length,
        rate:
          unmatchedRate
      },

      unmatchedMinusMatchedRate:
        Number.isFinite(
          unmatchedRate
        )
        &&
        Number.isFinite(
          matchedRate
        )
          ? unmatchedRate -
            matchedRate
          : null,

      rateRatioUnmatchedVsMatched:
        safeRatio(
          unmatchedRate,
          matchedRate
        )
    });
  }
}

const positiveSeparationCells =
  meleeAssociationMatrix
    .filter(
      row =>
        Number.isFinite(
          row.unmatchedMinusMatchedRate
        )
        &&
        row.unmatchedMinusMatchedRate >
          0
    )
    .sort(
      (
        a,
        b
      ) =>
        b.unmatchedMinusMatchedRate -
        a.unmatchedMinusMatchedRate
        ||
        a.windowSeconds -
        b.windowSeconds
        ||
        a.distanceHu -
        b.distanceHu
    );

const strongestPositiveSeparation =
  positiveSeparationCells[0] ??
  null;


// ============================================================
// CORE PREDECLARED MELEE ASSOCIATION
// ============================================================

const matchedCoreMelee =
  matched.filter(
    row =>
      Boolean(
        row.coreMeleeAssociation
      )
  );

const unmatchedCoreMelee =
  unmatched.filter(
    row =>
      Boolean(
        row.coreMeleeAssociation
      )
  );

const matchedCoreRate =
  rate(
    matchedCoreMelee.length,
    matched.length
  );

const unmatchedCoreRate =
  rate(
    unmatchedCoreMelee.length,
    unmatched.length
  );

const coreRateDifference =
  Number.isFinite(
    unmatchedCoreRate
  )
  &&
  Number.isFinite(
    matchedCoreRate
  )
    ? unmatchedCoreRate -
      matchedCoreRate
    : null;

const coreRateRatio =
  safeRatio(
    unmatchedCoreRate,
    matchedCoreRate
  );


// ============================================================
// MELEE ATTACK TYPE DISTRIBUTION
// ============================================================

const matchedCoreMeleeTypes =
  countByObject(
    matchedCoreMelee,
    row =>
      row
        .coreMeleeAssociation
        ?.attackType ??
      'UNKNOWN'
  );

const unmatchedCoreMeleeTypes =
  countByObject(
    unmatchedCoreMelee,
    row =>
      row
        .coreMeleeAssociation
        ?.attackType ??
      'UNKNOWN'
  );

const unmatchedCoreMeleePlayers =
  countByObject(
    unmatchedCoreMelee,
    row =>
      row
        .coreMeleeAssociation
        ?.playerName ??
      'UNKNOWN'
  );


// ============================================================
// NEAREST VERIFIED HIT DISTRIBUTIONS
// ============================================================

const matchedNearestMeleeTimeDelta =
  matched
    .map(
      row =>
        row
          ?.nearestVerifiedMeleeHit
          ?.absoluteTimeDeltaSeconds
    )
    .filter(
      Number.isFinite
    );

const unmatchedNearestMeleeTimeDelta =
  unmatched
    .map(
      row =>
        row
          ?.nearestVerifiedMeleeHit
          ?.absoluteTimeDeltaSeconds
    )
    .filter(
      Number.isFinite
    );

const matchedNearbyMeleeDistance =
  matched
    .flatMap(
      row =>
        row
          .verifiedMeleeHitsWithin1s
          .filter(
            candidate =>
              candidate.absoluteTimeDeltaSeconds <=
              CORE_MELEE_WINDOW_SECONDS
          )
          .map(
            candidate =>
              candidate.distance3D
          )
    );

const unmatchedNearbyMeleeDistance =
  unmatched
    .flatMap(
      row =>
        row
          .verifiedMeleeHitsWithin1s
          .filter(
            candidate =>
              candidate.absoluteTimeDeltaSeconds <=
              CORE_MELEE_WINDOW_SECONDS
          )
          .map(
            candidate =>
              candidate.distance3D
          )
    );


// ============================================================
// PLAYER PROXIMITY DISTRIBUTIONS
// ============================================================

const matchedNearest3D =
  matched
    .map(
      row =>
        row
          ?.playerProximity
          ?.nearestDistance3D
    )
    .filter(
      Number.isFinite
    );

const unmatchedNearest3D =
  unmatched
    .map(
      row =>
        row
          ?.playerProximity
          ?.nearestDistance3D
    )
    .filter(
      Number.isFinite
    );

const matchedNearestXY =
  matched
    .map(
      row =>
        row
          ?.playerProximity
          ?.nearestDistanceXY
    )
    .filter(
      Number.isFinite
    );

const unmatchedNearestXY =
  unmatched
    .map(
      row =>
        row
          ?.playerProximity
          ?.nearestDistanceXY
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// PLAYER DISTANCE THRESHOLD MATRIX
// ============================================================

const distanceThresholdMatrix =
  PLAYER_DISTANCE_THRESHOLDS.map(
    threshold => {
      const matchedInside =
        matched.filter(
          row =>
            Number.isFinite(
              row
                ?.playerProximity
                ?.nearestDistance3D
            )
            &&
            row
              .playerProximity
              .nearestDistance3D <=
              threshold
        ).length;

      const unmatchedInside =
        unmatched.filter(
          row =>
            Number.isFinite(
              row
                ?.playerProximity
                ?.nearestDistance3D
            )
            &&
            row
              .playerProximity
              .nearestDistance3D <=
              threshold
        ).length;

      return {
        threshold,

        matched: {
          inside:
            matchedInside,
          total:
            matched.length,
          rate:
            rate(
              matchedInside,
              matched.length
            )
        },

        unmatched: {
          inside:
            unmatchedInside,
          total:
            unmatched.length,
          rate:
            rate(
              unmatchedInside,
              unmatched.length
            )
        }
      };
    }
  );


// ============================================================
// BY BASE TYPE
// ============================================================

const byBaseType =
  [
    'RANGED',
    'MEDIC',
    'MELEE'
  ].map(
    baseType => {
      const rows =
        deaths.filter(
          row =>
            row.baseType ===
            baseType
        );

      const typeMatched =
        rows.filter(
          row =>
            row.groundSoulMatched
        );

      const typeUnmatched =
        rows.filter(
          row =>
            !row.groundSoulMatched
        );

      const typeMatchedCore =
        typeMatched.filter(
          row =>
            Boolean(
              row.coreMeleeAssociation
            )
        );

      const typeUnmatchedCore =
        typeUnmatched.filter(
          row =>
            Boolean(
              row.coreMeleeAssociation
            )
        );

      return {
        baseType,

        total:
          rows.length,

        matched:
          typeMatched.length,

        unmatched:
          typeUnmatched.length,

        matchRate:
          rate(
            typeMatched.length,
            rows.length
          ),

        coreMeleeAssociation: {
          windowSeconds:
            CORE_MELEE_WINDOW_SECONDS,

          distanceHu:
            CORE_MELEE_DISTANCE_HU,

          matched:
            typeMatchedCore.length,

          matchedRate:
            rate(
              typeMatchedCore.length,
              typeMatched.length
            ),

          unmatched:
            typeUnmatchedCore.length,

          unmatchedRate:
            rate(
              typeUnmatchedCore.length,
              typeUnmatched.length
            )
        },

        proximity: {
          matchedNearest3D:
            summarizeNumbers(
              typeMatched
                .map(
                  row =>
                    row
                      ?.playerProximity
                      ?.nearestDistance3D
                )
                .filter(
                  Number.isFinite
                )
            ),

          unmatchedNearest3D:
            summarizeNumbers(
              typeUnmatched
                .map(
                  row =>
                    row
                      ?.playerProximity
                      ?.nearestDistance3D
                )
                .filter(
                  Number.isFinite
                )
            )
        }
      };
    }
  );


// ============================================================
// UNMATCHED CANDIDATE ACTIVATIONS
// ============================================================

const unmatchedCandidateActivationCounts =
  countByObject(
    unmatched,
    row =>
      String(
        row.candidateActivationCount ??
        0
      )
  );


// ============================================================
// REMAINING UNMATCHED AFTER CORE MELEE ASSOCIATIONS
// ============================================================

const nonCoreMeleeUnmatched =
  unmatched.filter(
    row =>
      !row.coreMeleeAssociation
  );

const remainingNearest3D =
  nonCoreMeleeUnmatched
    .map(
      row =>
        row
          ?.playerProximity
          ?.nearestDistance3D
    )
    .filter(
      Number.isFinite
    );


// ============================================================
// PRODUCER / CONSUMER CONTRACT VALIDATION
// ============================================================

const expectedDirectAttacks =
  finite(
    meleeSummary
      ?.totalDirectAttacks
  );

const expectedConfirmedHits =
  finite(
    meleeSummary
      ?.confirmedHits
  );

const rawConfirmedHitCount =
  melee.filter(
    row =>
      row.hit ===
      true
  ).length;

const meleeContract = {
  source:
    'SCRIPT_16_CCitadel_Ability_HoldMelee',

  targetAttributionAvailable:
    false,

  targetAttributionUsed:
    false,

  associationBasis: [
    'hitObservedMatchTimeSeconds',
    'hitPosition',
    'opposing player team',
    'Trooper death time and position'
  ],

  checks: {
    rawRowsMatchProducerSummary:
      check(
        rawMelee.length,
        expectedDirectAttacks,
        expectedDirectAttacks ===
          null
          ? rawMelee.length >
            0
          : rawMelee.length ===
            expectedDirectAttacks
      ),

    normalizedRowsPreserved:
      check(
        melee.length,
        rawMelee.length,
        melee.length ===
          rawMelee.length
      ),

    producerConfirmedHitCountPreserved:
      check(
        rawConfirmedHitCount,
        expectedConfirmedHits,
        expectedConfirmedHits ===
          null
          ? rawConfirmedHitCount >
            0
          : rawConfirmedHitCount ===
            expectedConfirmedHits
      ),

    confirmedHitsHaveUsableDirectTelemetry:
      check(
        confirmedHits.length,
        '>0',
        confirmedHits.length >
          0
      )
  }
};

meleeContract.pass =
  Object
    .values(
      meleeContract.checks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// GLOBAL VALIDATION
// ============================================================

const validationChecks = {
  deathRowsLoaded:
    check(
      deaths.length,
      replayName ===
        'test'
        ? 1727
        : '>0',
      replayName ===
        'test'
        ? deaths.length ===
          1727
        : deaths.length >
          0
    ),

  matchedDeaths:
    check(
      matched.length,
      replayName ===
        'test'
        ? 1388
        : '>0',
      replayName ===
        'test'
        ? matched.length ===
          1388
        : matched.length >
          0
    ),

  unmatchedDeaths:
    check(
      unmatched.length,
      replayName ===
        'test'
        ? 339
        : '>=0',
      replayName ===
        'test'
        ? unmatched.length ===
          339
        : unmatched.length >=
          0
    ),

  meleeProducerConsumerContract:
    check(
      meleeContract.pass,
      true,
      meleeContract.pass
    ),

  usablePlayerSpatialRows:
    check(
      usablePlayerRows,
      '>0',
      usablePlayerRows >
        0
    ),

  matchedPlayerProximityResolved:
    check(
      matchedNearest3D.length,
      matched.length,
      matchedNearest3D.length ===
        matched.length
    ),

  unmatchedPlayerProximityMostlyResolved:
    check(
      unmatchedNearest3D.length,
      '>=95% of unmatched',
      unmatchedNearest3D.length >=
        Math.floor(
          unmatched.length *
          0.95
        )
    )
};

const validationPass =
  Object
    .values(
      validationChecks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// MELEE HYPOTHESIS INTERPRETATION
//
// This is descriptive only. We do not declare a lethal melee
// source from association alone.
// ============================================================

let meleeHypothesisStatus =
  'NO_ENRICHMENT_SIGNAL';

if (
  unmatchedCoreMelee.length >
    0
  &&
  Number.isFinite(
    coreRateDifference
  )
  &&
  coreRateDifference >
    0
) {
  meleeHypothesisStatus =
    'UNMATCHED_ENRICHED_FOR_VERIFIED_MELEE_ASSOCIATION';
}

if (
  unmatchedCoreMelee.length ===
  0
) {
  meleeHypothesisStatus =
    'NO_CORE_VERIFIED_MELEE_ASSOCIATION_AMONG_UNMATCHED';
}


// ============================================================
// CANDIDATE STREAM
//
// Only deaths with at least one verified opposing-team melee hit
// within the broad ±1 s temporal window are written here.
// ============================================================

const candidateRows =
  deaths
    .filter(
      row =>
        row
          .verifiedMeleeHitsWithin1s
          .length >
        0
    )
    .map(
      row => ({
        schemaVersion:
          2,

        canonical:
          false,

        deathIndex:
          row.deathIndex,

        deathKey:
          row.deathKey,

        entityIndex:
          row.entityIndex,

        baseType:
          row.baseType,

        trooperTeam:
          row.team,

        groundSoulMatched:
          row.groundSoulMatched,

        tick:
          row.tick,

        timeSeconds:
          row.timeSeconds,

        clock:
          row.clock,

        deathPosition:
          row.position,

        coreMeleeAssociation:
          row.coreMeleeAssociation,

        nearestVerifiedMeleeHit:
          row.nearestVerifiedMeleeHit,

        verifiedMeleeHitsWithin1s:
          row.verifiedMeleeHitsWithin1s,

        playerProximity:
          row.playerProximity
      })
    );


// ============================================================
// SUMMARY
// ============================================================

const summary = {
  replay:
    replayName,

  version:
    'TROOPER_GROUND_SOUL_UNMATCHED_DIAGNOSTIC_V02',

  canonical:
    false,

  status:
    validationPass
      ? meleeHypothesisStatus
      : 'DIAGNOSTIC_PIPELINE_FAILURE',

  supersedes: {
    output:
      'trooper_ground_soul_unmatched_diagnostic_v01.json',

    reason:
      'V01 expected target-attribution fields that Script 16 never emitted, causing zero normalized melee rows. V02 consumes Script 16 direct hit timing and hit-position fields instead.'
  },

  purpose: [
    'Repair the Script 16 -> Script 56 melee schema mismatch.',
    'Test whether unmatched ordinary economic Trooper deaths are enriched for verified melee-hit spatiotemporal associations.',
    'Retain nearest opposing-player distance as an independent ground-soul eligibility diagnostic.',
    'Do not infer lethal melee damage, missed farm, or player opportunity from association alone.'
  ],

  inputs: {
    deathStream:
      deathStreamPath,

    verifiedMeleeEvents:
      meleePath,

    meleeVerificationSummary:
      meleeSummaryPath,

    playerState:
      playerStatePath
  },

  sourceCounts: {
    economicTrooperDeaths:
      deaths.length,

    matchedGroundSoulDeaths:
      matched.length,

    unmatchedGroundSoulDeaths:
      unmatched.length,

    rawVerifiedMeleeRows:
      rawMelee.length,

    normalizedVerifiedMeleeRows:
      melee.length,

    rawConfirmedHitRows:
      rawConfirmedHitCount,

    confirmedHitsWithDirectTimeAndPosition:
      confirmedHits.length,

    playerStateRows:
      playerRows,

    usablePlayerSpatialRows:
      usablePlayerRows
  },

  meleeProducerConsumerContract:
    meleeContract,

  meleeAssociation: {
    semanticLimit:
      'Script 16 confirms that a melee attack hit something, but does not identify which entity was hit. Every association here is spatiotemporal candidate evidence only.',

    timeAlignment:
      'Uses Script 16 hitObservedMatchTimeSeconds directly. No ±30 second offset fitting is performed.',

    coreOperationalDefinition: {
      absoluteHitToDeathTimeSeconds:
        `<=${CORE_MELEE_WINDOW_SECONDS}`,

      attackerHitPositionToTrooperDeathDistanceHu:
        `<=${CORE_MELEE_DISTANCE_HU}`,

      opposingTeamRequired:
        true,

      note:
        'The 300-HU spatial gate is intentionally broad and diagnostic; it is not asserted to be the engine melee radius.'
    },

    coreResult: {
      matched: {
        associated:
          matchedCoreMelee.length,

        total:
          matched.length,

        rate:
          matchedCoreRate
      },

      unmatched: {
        associated:
          unmatchedCoreMelee.length,

        total:
          unmatched.length,

        rate:
          unmatchedCoreRate
      },

      unmatchedMinusMatchedRate:
        coreRateDifference,

      rateRatioUnmatchedVsMatched:
        coreRateRatio,

      hypothesisStatus:
        meleeHypothesisStatus,

      matchedAttackTypes:
        matchedCoreMeleeTypes,

      unmatchedAttackTypes:
        unmatchedCoreMeleeTypes,

      unmatchedPlayers:
        unmatchedCoreMeleePlayers
    },

    sensitivityMatrix:
      meleeAssociationMatrix,

    strongestPositiveSeparation:
      strongestPositiveSeparation,

    nearestHitTiming: {
      matched:
        summarizeNumbers(
          matchedNearestMeleeTimeDelta
        ),

      unmatched:
        summarizeNumbers(
          unmatchedNearestMeleeTimeDelta
        )
    },

    hitDistanceWithinCoreTimeWindow: {
      matched:
        summarizeNumbers(
          matchedNearbyMeleeDistance
        ),

      unmatched:
        summarizeNumbers(
          unmatchedNearbyMeleeDistance
        )
    },

    interpretation:
      unmatchedCoreMelee.length ===
        0
        ? 'No unmatched death has a verified opposing-team melee hit both within ±0.25 s and within 300 HU. This replay does not support melee-finisher suppression as an explanation for the unmatched ground-soul group under the core operational definition.'
        : coreRateDifference >
            0
          ? 'Unmatched deaths are more frequently associated with verified melee hits than matched deaths under the core diagnostic definition. This supports a focused lethal-damage-source validation, but does not establish melee causation.'
          : 'Verified melee associations occur, but unmatched deaths are not enriched relative to matched deaths under the core diagnostic definition.'
  },

  proximity: {
    matchedNearestOpponent: {
      distance3D:
        summarizeNumbers(
          matchedNearest3D
        ),

      distanceXY:
        summarizeNumbers(
          matchedNearestXY
        )
    },

    unmatchedNearestOpponent: {
      distance3D:
        summarizeNumbers(
          unmatchedNearest3D
        ),

      distanceXY:
        summarizeNumbers(
          unmatchedNearestXY
        )
    },

    thresholdMatrix:
      distanceThresholdMatrix,

    interpretation:
      'Distance is measured from Trooper death position to the temporally closest alive opposing-team player state within approximately ±0.5 s.'
  },

  afterRemovingCoreMeleeAssociatedUnmatched: {
    total:
      nonCoreMeleeUnmatched.length,

    nearestOpponentDistance3D:
      summarizeNumbers(
        remainingNearest3D
      )
  },

  byBaseType,

  unmatchedCandidateActivationCounts,

  examples: {
    unmatchedWithCoreMeleeAssociation:
      unmatchedCoreMelee
        .slice(
          0,
          MAX_EXAMPLES_PER_GROUP
        )
        .map(
          compactDeathExample
        ),

    unmatchedWithoutCoreMeleeAssociation:
      nonCoreMeleeUnmatched
        .slice(
          0,
          MAX_EXAMPLES_PER_GROUP
        )
        .map(
          compactDeathExample
        ),

    matchedWithCoreMeleeAssociation:
      matchedCoreMelee
        .slice(
          0,
          MAX_EXAMPLES_PER_GROUP
        )
        .map(
          compactDeathExample
        )
  },

  interpretationRules: {
    noTargetAttributionClaim:
      true,

    doNotCallUnmatchedMissedSoul:
      true,

    ifUnmatchedMeleeEnriched:
      'Build direct lethal-damage-source validation before promoting melee as causal.',

    ifUnmatchedMeleeNotEnriched:
      'Do not use melee final blows to explain the unmatched group. Continue with the validated ground-soul range/timing model.',

    ifNoUnmatchedCoreMelee:
      'Treat melee-finisher suppression as unsupported for this replay under the core spatiotemporal definition.'
  },

  validation: {
    pass:
      validationPass,

    checks:
      validationChecks
  },

  outputs: {
    summary:
      outputPath,

    meleeCandidateStream:
      outputCandidatePath
  }
};


// ============================================================
// WRITE OUTPUTS
// ============================================================

mkdirSync(
  dirname(
    outputPath
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  outputPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);

await writeJsonl(
  outputCandidatePath,
  candidateRows
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');
console.log(
  '========================================================'
);
console.log(
  'UNMATCHED GROUND SOUL DIAGNOSTIC V0.2'
);
console.log(
  '========================================================'
);
console.log('');

console.log(
  'SCRIPT 16 -> SCRIPT 56 CONTRACT'
);
console.log(
  '------------------------------'
);

for (
  const [
    name,
    row
  ]
  of Object.entries(
    meleeContract.checks
  )
) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');
console.log(
  'GROUND SOUL'
);
console.log(
  '-----------'
);
console.log(
  `Matched: ${matched.length}`
);
console.log(
  `Unmatched: ${unmatched.length}`
);
console.log(
  `Match rate: ${formatPercent(rate(matched.length, deaths.length))}`
);

console.log('');
console.log(
  'CORE VERIFIED MELEE ASSOCIATION'
);
console.log(
  '-------------------------------'
);
console.log(
  `Definition: ±${CORE_MELEE_WINDOW_SECONDS.toFixed(3)}s and <=${CORE_MELEE_DISTANCE_HU} HU, opposing-team confirmed hit`
);
console.log(
  `Matched:   ${matchedCoreMelee.length}/${matched.length} = ${formatPercent(matchedCoreRate)}`
);
console.log(
  `Unmatched: ${unmatchedCoreMelee.length}/${unmatched.length} = ${formatPercent(unmatchedCoreRate)}`
);
console.log(
  `Rate difference unmatched-matched: ${formatPercent(coreRateDifference)}`
);
console.log(
  `Rate ratio unmatched/matched: ${formatNumber(coreRateRatio)}`
);
console.log(
  `Melee hypothesis: ${meleeHypothesisStatus}`
);

console.log('');
console.log(
  'MELEE SENSITIVITY MATRIX'
);
console.log(
  '------------------------'
);

for (
  const windowSeconds
  of MELEE_WINDOWS_SECONDS
) {
  const rowParts =
    [];

  for (
    const distanceHu
    of MELEE_DISTANCE_THRESHOLDS_HU
  ) {
    const row =
      meleeAssociationMatrix.find(
        candidate =>
          candidate.windowSeconds ===
            windowSeconds
          &&
          candidate.distanceHu ===
            distanceHu
      );

    rowParts.push(
      `${distanceHu}HU:${row?.unmatched.associated ?? 0}/${row?.matched.associated ?? 0}`
    );
  }

  console.log(
    `±${windowSeconds.toFixed(4)}s  ${rowParts.join('  ')}`
  );
}

console.log('');
console.log(
  'NEAREST OPPOSING PLAYER'
);
console.log(
  '-----------------------'
);
console.log(
  `Matched median 3D: ${formatNumber(summarizeNumbers(matchedNearest3D).median)}`
);
console.log(
  `Unmatched median 3D: ${formatNumber(summarizeNumbers(unmatchedNearest3D).median)}`
);
console.log(
  `Unmatched minimum 3D: ${formatNumber(summarizeNumbers(unmatchedNearest3D).min)}`
);

console.log('');
console.log(
  'VALIDATION'
);
console.log(
  '----------'
);

for (
  const [
    name,
    row
  ]
  of Object.entries(
    validationChecks
  )
) {
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`
  );
}

console.log('');
console.log(
  `OVERALL PIPELINE: ${validationPass ? 'PASS' : 'FAIL'}`
);
console.log('');
console.log(
  `Summary:\n${outputPath}`
);
console.log('');
console.log(
  `Melee candidates:\n${outputCandidatePath}`
);
console.log('');


// ============================================================
// DEATH NORMALIZATION
// ============================================================

function normalizeDeath(
  row
) {
  const entityIndex =
    finite(
      row
        ?.trooper
        ?.entityIndex
    );

  const timeSeconds =
    finite(
      row
        ?.timing
        ?.timeSeconds
    );

  const tick =
    finite(
      row
        ?.timing
        ?.tick
    );

  const position =
    normalizePosition(
      row
        ?.trooper
        ?.position
    );

  if (
    entityIndex ===
      null
    ||
    timeSeconds ===
      null
    ||
    tick ===
      null
    ||
    !position
  ) {
    return null;
  }

  const matchStatus =
    row
      ?.match
      ?.status ??
    null;

  const groundSoulMatched =
    matchStatus ===
      'ONE_TO_ONE_ASSIGNED_GOLD_MATCH'
    ||
    Boolean(
      row.groundSoul
    );

  return {
    deathIndex:
      finite(
        row.deathIndex
      ),

    deathKey:
      row.deathKey ??
      null,

    lifeId:
      row.lifeId ??
      null,

    entityIndex,

    baseType:
      row
        ?.trooper
        ?.baseType ??
      'UNKNOWN',

    variantLabel:
      row
        ?.trooper
        ?.variantLabel ??
      'UNKNOWN',

    isSuper:
      row
        ?.trooper
        ?.isSuper ===
      true,

    isRift:
      row
        ?.trooper
        ?.isRift ===
      true,

    team:
      finite(
        row
          ?.trooper
          ?.team
      ),

    lane:
      finite(
        row
          ?.trooper
          ?.lane
      ),

    maxHealth:
      finite(
        row
          ?.trooper
          ?.maxHealth
      ),

    position,

    tick,

    timeSeconds,

    clock:
      row
        ?.timing
        ?.clock ??
      formatClock(
        timeSeconds
      ),

    groundSoulMatched,

    candidateActivationCount:
      finite(
        row
          ?.match
          ?.candidateActivationCount ??
        row
          ?.match
          ?.deathCandidateCount
      ) ??
      0,

    verifiedMeleeHitsWithin1s:
      [],

    nearestVerifiedMeleeHit:
      null,

    coreMeleeAssociation:
      null,

    playerProximity:
      null
  };
}


// ============================================================
// SCRIPT 16 VERIFIED MELEE NORMALIZATION
// ============================================================

function normalizeVerifiedMelee(
  row,
  index
) {
  const firstObservedTick =
    firstFinite([
      row?.firstObservedTick,
      row?.tick
    ]);

  const firstObservedMatchTimeSeconds =
    firstFinite([
      row?.firstObservedMatchTimeSeconds,
      Number.isFinite(
        firstObservedTick
      )
        ? firstObservedTick /
          TICK_RATE -
          30
        : null
    ]);

  const hitObservedTick =
    firstFinite([
      row?.hitObservedTick
    ]);

  const hitObservedMatchTimeSeconds =
    firstFinite([
      row?.hitObservedMatchTimeSeconds,
      Number.isFinite(
        hitObservedTick
      )
        ? hitObservedTick /
          TICK_RATE -
          30
        : null
    ]);

  const attackTriggeredTime =
    firstFinite([
      row?.attackTriggeredTime,
      row?.attack_trigger_time,
      row?.attackTriggerTime
    ]);

  const playerName =
    firstString([
      row?.playerName,
      row?.player?.playerName,
      row?.player?.name
    ]);

  const playerTeam =
    firstFinite([
      row?.team,
      row?.playerTeam,
      row?.player?.team
    ]);

  const attackType =
    String(
      row?.attackType ??
      row?.attack_type ??
      'UNKNOWN'
    );

  const hit =
    row?.hit ===
    true;

  const attackPosition =
    normalizePosition(
      row?.attackPosition ??
      row?.position ??
      null
    );

  const hitPosition =
    normalizePosition(
      row?.hitPosition ??
      null
    ) ??
    attackPosition;

  return {
    meleeIndex:
      index,

    key:
      row?.key ??
      null,

    abilityEntityIndex:
      finite(
        row?.abilityEntityIndex
      ),

    pawnEntityIndex:
      finite(
        row?.pawnEntityIndex
      ),

    controllerEntityIndex:
      finite(
        row?.controllerEntityIndex
      ),

    playerName,

    playerTeam,

    heroId:
      finite(
        row?.heroId
      ),

    attackTypeCode:
      finite(
        row?.attackTypeCode
      ),

    attackType,

    attackTriggeredTime,

    firstObservedTick,

    firstObservedMatchTimeSeconds,

    attackPosition,

    hit,

    hitObservedTick,

    hitObservedMatchTimeSeconds,

    hitTimeSeconds:
      hitObservedMatchTimeSeconds,

    hitPosition
  };
}


// ============================================================
// VERIFIED MELEE ASSOCIATION SEARCH
// ============================================================

function findNearbyVerifiedMeleeHits(
  death
) {
  if (
    death.team !==
      2
    &&
    death.team !==
      3
  ) {
    return [];
  }

  const opposingTeam =
    death.team ===
      2
      ? 3
      : 2;

  const minTime =
    death.timeSeconds -
    MAX_MELEE_SEARCH_SECONDS;

  const maxTime =
    death.timeSeconds +
    MAX_MELEE_SEARCH_SECONDS;

  const start =
    lowerBoundByHitTime(
      confirmedHits,
      minTime
    );

  const candidates =
    [];

  for (
    let i =
      start;

    i <
      confirmedHits.length
      &&
      confirmedHits[i].hitTimeSeconds <=
        maxTime;

    i++
  ) {
    const attack =
      confirmedHits[i];

    if (
      attack.playerTeam !==
      opposingTeam
    ) {
      continue;
    }

    const deltaSeconds =
      attack.hitTimeSeconds -
      death.timeSeconds;

    const distance3D =
      getDistance3D(
        death.position,
        attack.hitPosition
      );

    const distanceXY =
      getDistanceXY(
        death.position,
        attack.hitPosition
      );

    candidates.push({
      meleeIndex:
        attack.meleeIndex,

      playerName:
        attack.playerName,

      playerTeam:
        attack.playerTeam,

      heroId:
        attack.heroId,

      attackType:
        attack.attackType,

      attackTypeCode:
        attack.attackTypeCode,

      hitObservedTick:
        attack.hitObservedTick,

      hitObservedMatchTimeSeconds:
        attack.hitObservedMatchTimeSeconds,

      hitObservedClock:
        formatClock(
          attack.hitObservedMatchTimeSeconds
        ),

      timeDeltaSeconds:
        deltaSeconds,

      absoluteTimeDeltaSeconds:
        Math.abs(
          deltaSeconds
        ),

      distance3D,

      distanceXY,

      attackerHitPosition:
        attack.hitPosition,

      associationOnly:
        true
    });
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      a.absoluteTimeDeltaSeconds -
      b.absoluteTimeDeltaSeconds
      ||
      a.distance3D -
      b.distance3D
      ||
      a.meleeIndex -
      b.meleeIndex
  );

  return candidates;
}


function lowerBoundByHitTime(
  rows,
  timeSeconds
) {
  let low =
    0;

  let high =
    rows.length;

  while (
    low <
    high
  ) {
    const mid =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );

    if (
      rows[mid].hitTimeSeconds <
      timeSeconds
    ) {
      low =
        mid +
        1;
    } else {
      high =
        mid;
    }
  }

  return low;
}


function hasVerifiedMeleeAssociation(
  death,
  windowSeconds,
  distanceHu
) {
  return death
    .verifiedMeleeHitsWithin1s
    .some(
      candidate =>
        candidate.absoluteTimeDeltaSeconds <=
          windowSeconds
        &&
        candidate.distance3D <=
          distanceHu
    );
}


// ============================================================
// PLAYER PROXIMITY AT DEATH
// ============================================================

function findOpposingPlayerProximity(
  death
) {
  if (
    death.team !==
      2
    &&
    death.team !==
      3
  ) {
    return {
      resolved:
        false,

      reason:
        'INVALID_TROOPER_TEAM'
    };
  }

  const opposingTeam =
    death.team ===
      2
      ? 3
      : 2;

  const centerBucket =
    Math.round(
      death.timeSeconds *
      PLAYER_STATE_BUCKET_HZ
    );

  const nearestByPlayer =
    new Map();

  for (
    let offset =
      -PLAYER_STATE_SEARCH_BUCKETS;

    offset <=
      PLAYER_STATE_SEARCH_BUCKETS;

    offset++
  ) {
    const rows =
      playerBuckets.get(
        centerBucket +
        offset
      ) ??
      [];

    for (
      const row
      of rows
    ) {
      if (
        row.team !==
        opposingTeam
      ) {
        continue;
      }

      const timeDelta =
        Math.abs(
          row.timeSeconds -
          death.timeSeconds
        );

      const existing =
        nearestByPlayer.get(
          row.playerName
        );

      if (
        !existing
        ||
        timeDelta <
          existing.timeDelta
      ) {
        nearestByPlayer.set(
          row.playerName,
          {
            ...row,
            timeDelta
          }
        );
      }
    }
  }

  const candidates =
    [];

  for (
    const row
    of nearestByPlayer.values()
  ) {
    const distance3D =
      getDistance3D(
        death.position,
        row.position
      );

    const distanceXY =
      getDistanceXY(
        death.position,
        row.position
      );

    candidates.push({
      playerName:
        row.playerName,

      pawnEntityIndex:
        row.pawnEntityIndex,

      team:
        row.team,

      playerStateTimeSeconds:
        row.timeSeconds,

      absoluteTimeDeltaSeconds:
        row.timeDelta,

      distance3D,

      distanceXY,

      position:
        row.position
    });
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      a.distance3D -
      b.distance3D
  );

  const nearest =
    candidates[0] ??
    null;

  const withinThresholds =
    {};

  for (
    const threshold
    of PLAYER_DISTANCE_THRESHOLDS
  ) {
    withinThresholds[
      String(
        threshold
      )
    ] =
      candidates.filter(
        row =>
          row.distance3D <=
          threshold
      ).length;
  }

  return {
    resolved:
      Boolean(
        nearest
      ),

    opposingTeam,

    nearestPlayer:
      nearest,

    nearestDistance3D:
      nearest?.distance3D ??
      null,

    nearestDistanceXY:
      nearest?.distanceXY ??
      null,

    opposingPlayersResolved:
      candidates.length,

    playersWithinThresholds:
      withinThresholds
  };
}


// ============================================================
// OUTPUT EXAMPLE
// ============================================================

function compactDeathExample(
  row
) {
  return {
    deathIndex:
      row.deathIndex,

    deathKey:
      row.deathKey,

    entityIndex:
      row.entityIndex,

    baseType:
      row.baseType,

    variantLabel:
      row.variantLabel,

    team:
      row.team,

    tick:
      row.tick,

    timeSeconds:
      row.timeSeconds,

    clock:
      row.clock,

    groundSoulMatched:
      row.groundSoulMatched,

    candidateActivationCount:
      row.candidateActivationCount,

    deathPosition:
      row.position,

    coreMeleeAssociation:
      row.coreMeleeAssociation,

    nearestVerifiedMeleeHit:
      row.nearestVerifiedMeleeHit,

    nearestOpponent:
      row
        ?.playerProximity
        ?.nearestPlayer ??
      null,

    nearestOpponentDistance3D:
      row
        ?.playerProximity
        ?.nearestDistance3D ??
      null
  };
}


// ============================================================
// POSITION HELPERS
// ============================================================

function normalizePosition(
  value
) {
  if (
    !value
  ) {
    return null;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    const x =
      finite(
        value[0]
      );

    const y =
      finite(
        value[1]
      );

    const z =
      finite(
        value[2]
      );

    if (
      x ===
        null
      ||
      y ===
        null
      ||
      z ===
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

  if (
    typeof value ===
    'object'
  ) {
    const x =
      firstFinite([
        value.x,
        value.X,
        value[0]
      ]);

    const y =
      firstFinite([
        value.y,
        value.Y,
        value[1]
      ]);

    const z =
      firstFinite([
        value.z,
        value.Z,
        value[2]
      ]);

    if (
      x ===
        null
      ||
      y ===
        null
      ||
      z ===
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

  return null;
}


function getDistance3D(
  a,
  b
) {
  const dx =
    a.x -
    b.x;

  const dy =
    a.y -
    b.y;

  const dz =
    a.z -
    b.z;

  return Math.sqrt(
    dx * dx +
    dy * dy +
    dz * dz
  );
}


function getDistanceXY(
  a,
  b
) {
  const dx =
    a.x -
    b.x;

  const dy =
    a.y -
    b.y;

  return Math.sqrt(
    dx * dx +
    dy * dy
  );
}


// ============================================================
// FILE HELPERS
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


async function writeJsonl(
  path,
  rows
) {
  const {
    createWriteStream
  } =
    await import(
      'node:fs'
    );

  const writer =
    createWriteStream(
      path,
      {
        encoding:
          'utf8'
      }
    );

  for (
    const row
    of rows
  ) {
    writer.write(
      `${JSON.stringify(row)}\n`
    );
  }

  await new Promise(
    (
      accept,
      reject
    ) => {
      writer.on(
        'error',
        reject
      );

      writer.end(
        accept
      );
    }
  );
}


// ============================================================
// GENERIC HELPERS
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


function firstFinite(
  values
) {
  for (
    const value
    of values
  ) {
    const number =
      finite(
        value
      );

    if (
      number !==
      null
    ) {
      return number;
    }
  }

  return null;
}


function firstString(
  values
) {
  for (
    const value
    of values
  ) {
    if (
      typeof value ===
        'string'
      &&
      value.length >
        0
    ) {
      return value;
    }
  }

  return null;
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


function safeRatio(
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
  ) {
    return null;
  }

  if (
    denominator ===
    0
  ) {
    return null;
  }

  return numerator /
    denominator;
}


function countByObject(
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
      String(
        selector(
          row
        )
      );

    map.set(
      key,
      (
        map.get(
          key
        ) ??
        0
      ) +
      1
    );
  }

  return Object.fromEntries(
    [
      ...map.entries()
    ].sort(
      (
        a,
        b
      ) =>
        b[1] -
        a[1]
        ||
        a[0].localeCompare(
          b[0]
        )
    )
  );
}


function summarizeNumbers(
  values
) {
  const clean =
    values
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

      p10:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p90:
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

    p10:
      quantile(
        clean,
        0.10
      ),

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

    p90:
      quantile(
        clean,
        0.90
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
      clean.reduce(
        (
          total,
          value
        ) =>
          total +
          value,
        0
      ) /
      clean.length
  };
}


function quantile(
  values,
  q
) {
  if (
    values.length ===
    0
  ) {
    return null;
  }

  if (
    values.length ===
    1
  ) {
    return values[0];
  }

  const position =
    (
      values.length -
      1
    ) *
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
    return values[
      lower
    ];
  }

  const weight =
    position -
    lower;

  return values[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    values[
      upper
    ] *
    weight;
}


function check(
  actual,
  expected,
  pass
) {
  return {
    actual,
    expected,
    pass:
      Boolean(
        pass
      )
  };
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
    ).toFixed(2)}%`
    : 'n/a';
}


function formatNumber(
  value
) {
  return Number.isFinite(
    value
  )
    ? Number(
      value.toFixed(
        3
      )
    ).toString()
    : 'n/a';
}


function formatClock(
  timeSeconds
) {
  if (
    !Number.isFinite(
      timeSeconds
    )
  ) {
    return null;
  }

  const sign =
    timeSeconds <
      0
      ? '-'
      : '';

  const absolute =
    Math.abs(
      timeSeconds
    );

  const minutes =
    Math.floor(
      absolute /
      60
    );

  const seconds =
    Math.floor(
      absolute %
      60
    );

  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}