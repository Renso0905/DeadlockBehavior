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
  'HERO_SPECIFIC_SHOT_TRAVEL_CANDIDATE_MODELS_V01';


// ============================================================
// PURPOSE
//
// Script126:
//   recovered primary-weapon discharge telemetry.
//
// Script127:
//   showed true successful CItemXP hit times are very strongly
//   enriched for preceding same-player weapon discharge versus
//   shifted placebo times.
//
// Script128 now asks:
//
//   Among ALL plausible preceding same-player shots, is there
//   a coherent HERO-SPECIFIC relationship between:
//
//       shot time
//       shot-origin -> impact distance
//       observed CItemXP impact time
//
// We do NOT assume the nearest preceding shot is the source.
//
// For each hero, this script fits a latent candidate model:
//
//   predicted latency ticks
//
//     = fixed delay ticks
//       + distanceHU * 64 / speedHUPerSecond
//
// For every successful hit, the candidate shot with the lowest
// residual under the shared hero model is provisionally assigned.
//
// IMPORTANT:
//
//   - This is NOT direct projectile attribution.
//   - This is NOT a canonical projectile speed.
//   - High-speed weapons may be tick-quantization limited.
//   - Several candidate shots may remain equally plausible.
//   - The model is intended to determine whether empirical
//     travel-time structure is recoverable from replay telemetry.
//
// No raw replay parsing.
// No opportunity classification.
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const TICK_RATE =
  64;


const REPLAYS =
  [
    'rep01',
    'rep02',
    'rep03',
    'rep04',
    'rep05'
  ];


// Candidate shots up to one second before the successful impact.
const MAX_PRECEDING_TICKS =
  64;


// Preserve the same firing-origin uncertainty used in the
// static-access branch.
const ORIGIN_Z_OFFSETS_HU =
  [
    64,
    80
  ];


// Empirical search region.
//
// Speeds at or near the upper boundary are NOT interpreted as
// measured speed; they are classified as timing-resolution
// limited.
const MIN_SPEED_HU_PER_SECOND =
  1200;


const MAX_SPEED_HU_PER_SECOND =
  80000;


const SPEED_GRID_POINTS =
  240;


// Small fixed latency term.
//
// This may absorb network/event registration offsets or a true
// fixed firing component. It is not automatically game-engine
// firing delay.
const FIXED_DELAY_TICKS =
  [
    0,
    0.25,
    0.5,
    0.75,
    1,
    1.25,
    1.5,
    1.75,
    2
  ];


// Residuals above this do not increasingly dominate the robust
// objective.
const LOSS_CLIP_TICKS =
  4;


// Candidate ambiguity:
// if the second-best candidate is <0.5 tick worse than the best,
// source-shot identity remains locally ambiguous.
const UNAMBIGUOUS_MARGIN_TICKS =
  0.5;


// Hero model minimums.
const MIN_HITS_FOR_MODEL =
  5;


const MIN_HITS_FOR_STRONG_INTERPRETATION =
  10;


// ============================================================
// OUTPUTS
// ============================================================

const outputCandidatePath =
  resolve(
    'output',
    'cross_replay',
    'hero_specific_shot_travel_candidates_v01.jsonl'
  );


const outputAssignmentPath =
  resolve(
    'output',
    'cross_replay',
    'hero_specific_shot_travel_assignments_v01.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    'cross_replay',
    'hero_specific_shot_travel_candidate_models_v01.json'
  );


const outputMarkdownPath =
  resolve(
    'output',
    'cross_replay',
    'hero_specific_shot_travel_candidate_models_v01.md'
  );


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'HERO-SPECIFIC SHOT TRAVEL CANDIDATE MODELS V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'Replays:                    rep01-rep05'
);

console.log(
  'Successful-hit cohort:      Script126'
);

console.log(
  'Candidate shots:            all same-player shots <=1s before hit'
);

console.log(
  'Shot origin probes:         Z+64 / Z+80'
);

console.log(
  'Source-shot assumption:     NONE'
);

console.log(
  'Raw .dem parsing:           NONE'
);

console.log(
  'Canonical projectile speed: NO'
);

console.log('');


// ============================================================
// DATA CONTAINERS
// ============================================================

const hits =
  [];


const allCandidateRows =
  [];


const replayShotCounts =
  {};


const replayHitCounts =
  {};


// ============================================================
// LOAD EACH REPLAY
// ============================================================

for (
  const replay
  of REPLAYS
) {

  console.log(
    `Loading ${replay}...`
  );


  const shotsPath =
    resolve(
      'output',
      replay,
      'primary_weapon_shot_events_v01.jsonl'
    );


  const matchesPath =
    resolve(
      'output',
      replay,
      'primary_weapon_soul_hit_matches_v01.jsonl'
    );


  const playerStatePath =
    resolve(
      'output',
      replay,
      'player_state.jsonl'
    );


  const script126SummaryPath =
    resolve(
      'output',
      replay,
      'primary_weapon_shot_telemetry_validation_v01.json'
    );


  for (
    const path
    of [
      shotsPath,
      matchesPath,
      playerStatePath,
      script126SummaryPath
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


  const script126Summary =
    JSON.parse(
      readFileSync(
        script126SummaryPath,
        'utf8'
      )
    );


  if (
    script126Summary?.status !==
    'PRIMARY_WEAPON_SHOT_TELEMETRY_STRONGLY_SUPPORTED'
  ) {

    throw new Error(
      `${replay}: Script126 not ready. Status=${script126Summary?.status}`
    );
  }


  const shotsRaw =
    await loadJsonl(
      shotsPath
    );


  const matches =
    await loadJsonl(
      matchesPath
    );


  const playerState =
    await loadPlayerPositionTimelines(
      playerStatePath
    );


  const shots =
    deduplicateShots(
      shotsRaw
    );


  const shotsByPlayer =
    groupShotsByPlayer(
      shots
    );


  replayShotCounts[
    replay
  ] =
    shots.length;


  replayHitCounts[
    replay
  ] =
    matches.length;


  console.log(
    `  shots=${shots.length} hits=${matches.length} players=${shotsByPlayer.size}`
  );


  for (
    let hitIndex =
      0;

    hitIndex <
      matches.length;

    hitIndex++
  ) {

    const match =
      matches[
        hitIndex
      ];


    const playerName =
      match
        ?.hit
        ?.playerName
      ??
      null;


    const heroId =
      finite(
        match
          ?.hit
          ?.heroId
      );


    const hitTick =
      finite(
        match
          ?.hit
          ?.tick
      );


    const orbImpactPosition =
      normalizePosition(
        match
          ?.hit
          ?.orbPosition
      );


    if (
      !playerName
      ||
      heroId ===
      null
      ||
      hitTick ===
      null
      ||
      !orbImpactPosition
    ) {

      continue;
    }


    const playerShots =
      shotsByPlayer.get(
        playerName
      )
      ??
      [];


    const precedingShots =
      collectStrictlyPrecedingShots({
        shots:
          playerShots,

        hitTick,

        maximumTicks:
          MAX_PRECEDING_TICKS
      });


    // rank 1 = nearest preceding shot.
    precedingShots.sort(
      (
        a,
        b
      ) =>
        b.tick -
        a.tick
    );


    const candidateRows =
      [];


    for (
      let candidateIndex =
        0;

      candidateIndex <
        precedingShots.length;

      candidateIndex++
    ) {

      const shot =
        precedingShots[
          candidateIndex
        ];


      const shotTick =
        finite(
          shot.tick
        );


      if (
        shotTick ===
        null
      ) {

        continue;
      }


      const latencyTicks =
        hitTick -
        shotTick;


      if (
        latencyTicks <=
        0
        ||
        latencyTicks >
        MAX_PRECEDING_TICKS
      ) {

        continue;
      }


      const playerPositionState =
        reconstructPlayerPositionAtTick({
          rows:
            playerState.get(
              playerName
            )
            ??
            [],

          tick:
            shotTick
        });


      if (
        !playerPositionState?.position
      ) {

        continue;
      }


      const distances =
        {};


      for (
        const zOffset
        of ORIGIN_Z_OFFSETS_HU
      ) {

        const shotOrigin =
          {
            x:
              playerPositionState.position.x,

            y:
              playerPositionState.position.y,

            z:
              playerPositionState.position.z +
              zOffset
          };


        distances[
          String(
            zOffset
          )
        ] =
          distance3D(
            shotOrigin,
            orbImpactPosition
          );
      }


      const distance64 =
        distances[
          '64'
        ];


      const distance80 =
        distances[
          '80'
        ];


      const distanceMid =
        (
          distance64 +
          distance80
        ) /
        2;


      const impliedSpeedHUPerSecond =
        distanceMid /
        (
          latencyTicks /
          TICK_RATE
        );


      const candidate =
        {
          schemaVersion:
            1,

          canonical:
            false,

          replay,

          hitIndex,

          hitKey:
            `${replay}|${hitIndex}`,

          eventId:
            match.eventId
            ??
            null,

          playerName,

          heroId,

          hitTick,

          shotTick,

          latencyTicks,

          latencySeconds:
            latencyTicks /
            TICK_RATE,

          precedingRank:
            candidateIndex +
            1,

          weaponEntityIndex:
            finite(
              shot.weaponEntityIndex
            ),

          weaponClass:
            shot.weaponClass
            ??
            null,

          weaponSubclassId:
            finite(
              shot.weaponSubclassId
            ),

          shotSignalConfidence:
            shot
              ?.signal
              ?.confidence
            ??
            null,

          playerPositionMethod:
            playerPositionState.method,

          playerPosition:
            playerPositionState.position,

          orbImpactPosition,

          firingOriginDistanceHU:
            {
              z64:
                distance64,

              z80:
                distance80,

              midpoint:
                distanceMid,

              probeSpreadHU:
                Math.abs(
                  distance80 -
                  distance64
                )
            },

          impliedSpeedHUPerSecond,

          semanticStatus:
            'POSSIBLE_PRECEDING_SOURCE_SHOT_NOT_ATTRIBUTED'
        };


      candidateRows.push(
        candidate
      );


      allCandidateRows.push(
        candidate
      );
    }


    hits.push(
      {
        replay,

        hitIndex,

        hitKey:
          `${replay}|${hitIndex}`,

        eventId:
          match.eventId
          ??
          null,

        playerName,

        heroId,

        hitTick,

        orbImpactPosition,

        candidates:
          candidateRows
      }
    );
  }
}


console.log('');

console.log(
  `Normalized successful hits: ${hits.length}`
);

console.log(
  `Candidate shot pairs:       ${allCandidateRows.length}`
);

console.log('');


// ============================================================
// HERO GROUPS
// ============================================================

const hitsByHero =
  new Map();


for (
  const hit
  of hits
) {

  const key =
    String(
      hit.heroId
    );


  if (
    !hitsByHero.has(
      key
    )
  ) {

    hitsByHero.set(
      key,
      []
    );
  }


  hitsByHero
    .get(
      key
    )
    .push(
      hit
    );
}


// ============================================================
// MODEL FITTING
// ============================================================

const speedGrid =
  buildLogGrid(
    MIN_SPEED_HU_PER_SECOND,
    MAX_SPEED_HU_PER_SECOND,
    SPEED_GRID_POINTS
  );


const heroModels =
  [];


const allAssignmentRows =
  [];


for (
  const [
    heroKey,
    heroHits
  ]
  of hitsByHero
) {

  const heroId =
    Number(
      heroKey
    );


  const modeledHits =
    heroHits.filter(
      hit =>
        hit.candidates.length >
        0
    );


  const replaySet =
    new Set(
      heroHits.map(
        hit =>
          hit.replay
      )
    );


  if (
    modeledHits.length <
    MIN_HITS_FOR_MODEL
  ) {

    heroModels.push(
      buildInsufficientHeroSummary({
        heroId,
        heroHits,
        modeledHits,
        replaySet
      })
    );

    continue;
  }


  console.log(
    `Fitting hero ${heroId}: hits=${heroHits.length}, modeled=${modeledHits.length}, replays=${replaySet.size}`
  );


  const fit =
    fitHeroModel({
      hits:
        modeledHits,

      speedGrid,

      delayGrid:
        FIXED_DELAY_TICKS
    });


  const assignment =
    assignHitsUnderModel({
      hits:
        modeledHits,

      speedHUPerSecond:
        fit.speedHUPerSecond,

      fixedDelayTicks:
        fit.fixedDelayTicks
    });


  for (
    const row
    of assignment.rows
  ) {

    allAssignmentRows.push(
      row
    );
  }


  const crossReplay =
    buildLeaveOneReplayOutValidation({
      heroHits:
        modeledHits,

      speedGrid,

      delayGrid:
        FIXED_DELAY_TICKS
    });


  const modelStatus =
    classifyHeroModel({
      hitCount:
        heroHits.length,

      modeledHitCount:
        modeledHits.length,

      speedHUPerSecond:
        fit.speedHUPerSecond,

      residual:
        assignment.residualTicks,

      unambiguousRate:
        assignment.unambiguousRate
    });


  heroModels.push(
    {
      heroId,

      status:
        modelStatus,

      hits:
        heroHits.length,

      modeledHits:
        modeledHits.length,

      modelCoverage:
        rate(
          modeledHits.length,
          heroHits.length
        ),

      replayCount:
        replaySet.size,

      replays:
        [
          ...replaySet
        ].sort(),

      candidateShotPairs:
        sum(
          modeledHits.map(
            hit =>
              hit.candidates.length
          )
        ),

      candidatesPerHit:
        summarizeNumbers(
          modeledHits.map(
            hit =>
              hit.candidates.length
          )
        ),

      fittedModel:
        {
          speedHUPerSecond:
            fit.speedHUPerSecond,

          fixedDelayTicks:
            fit.fixedDelayTicks,

          fixedDelaySeconds:
            fit.fixedDelayTicks /
            TICK_RATE,

          robustObjective:
            fit.objective,

          searchBoundary:
            {
              atMinimumSpeed:
                fit.speedHUPerSecond <=
                MIN_SPEED_HU_PER_SECOND *
                1.001,

              atMaximumSpeed:
                fit.speedHUPerSecond >=
                MAX_SPEED_HU_PER_SECOND *
                0.999,

              highSpeedTimingResolutionLimited:
                fit.speedHUPerSecond >=
                MAX_SPEED_HU_PER_SECOND *
                0.90
            }
        },

      assignments:
        {
          residualTicks:
            assignment.residualTicks,

          assignedLatencyTicks:
            assignment.latencyTicks,

          assignedDistanceHU:
            assignment.distanceHU,

          assignedImpliedSpeedHUPerSecond:
            assignment.impliedSpeedHUPerSecond,

          precedingRank:
            assignment.precedingRank,

          assignedNearestShotCount:
            assignment.nearestCount,

          assignedNearestShotRate:
            assignment.nearestRate,

          unambiguousCount:
            assignment.unambiguousCount,

          unambiguousRate:
            assignment.unambiguousRate,

          residualWithinHalfTick:
            assignment.withinHalfTick,

          residualWithinHalfTickRate:
            assignment.withinHalfTickRate,

          residualWithinOneTick:
            assignment.withinOneTick,

          residualWithinOneTickRate:
            assignment.withinOneTickRate,

          residualWithinTwoTicks:
            assignment.withinTwoTicks,

          residualWithinTwoTicksRate:
            assignment.withinTwoTicksRate
        },

      leaveOneReplayOut:
        crossReplay,

      interpretation:
        classifyHeroInterpretation({
          modelStatus,

          fit,

          assignment,

          replaySet
        })
    }
  );
}


// ============================================================
// SORT HERO MODELS
// ============================================================

heroModels.sort(
  (
    a,
    b
  ) =>
    b.hits -
    a.hits
    ||
    a.heroId -
    b.heroId
);


// ============================================================
// GLOBAL INTEGRITY
// ============================================================

const modeledHitsGlobal =
  hits.filter(
    hit =>
      hit.candidates.length >
      0
  ).length;


const expectedSuccessfulHits =
  529;


const integrityChecks =
  {
    fiveReplayCohortLoaded:
      check(
        REPLAYS.length,
        5,
        REPLAYS.length ===
        5
      ),


    successfulHitCohortPreserved:
      check(
        hits.length,
        expectedSuccessfulHits,
        hits.length ===
        expectedSuccessfulHits
      ),


    candidatePairsAvailable:
      check(
        allCandidateRows.length,
        '>0',
        allCandidateRows.length >
        0
      ),


    candidateCoverageHigh:
      check(
        rate(
          modeledHitsGlobal,
          hits.length
        ),
        '>=0.95',
        rate(
          modeledHitsGlobal,
          hits.length
        ) >=
        0.95
      )
  };


const integrityPass =
  Object
    .values(
      integrityChecks
    )
    .every(
      row =>
        row.pass
    );


const interpretableHeroModels =
  heroModels.filter(
    row =>
      [
        'PROVISIONAL_FINITE_TRAVEL_MODEL',
        'HIGH_SPEED_TIMING_RESOLUTION_LIMITED'
      ].includes(
        row.status
      )
  );


const finiteResolvedHeroModels =
  heroModels.filter(
    row =>
      row.status ===
      'PROVISIONAL_FINITE_TRAVEL_MODEL'
  );


const highSpeedLimitedHeroModels =
  heroModels.filter(
    row =>
      row.status ===
      'HIGH_SPEED_TIMING_RESOLUTION_LIMITED'
  );


const status =
  integrityPass
    ? 'HERO_SPECIFIC_SHOT_TRAVEL_CANDIDATE_MODELS_READY_FOR_INTERPRETATION'
    : 'SHOT_TRAVEL_CANDIDATE_MODEL_INTEGRITY_FAILURE';


const nextStage =
  integrityPass
    ? 'INSPECT_FINITE_VS_QUANTIZATION_LIMITED_HEROES_THEN_VALIDATE_WEAPON_READY_STATE'
    : 'DIAGNOSE_SHOT_TRAVEL_CANDIDATE_SUBSTRATE';


// ============================================================
// WRITE ROW FILES
// ============================================================

writeJsonl(
  outputCandidatePath,
  allCandidateRows
);


writeJsonl(
  outputAssignmentPath,
  allAssignmentRows
);


// ============================================================
// SUMMARY
// ============================================================

const summary =
  {
    version:
      VERSION,

    canonical:
      false,

    createdAt:
      new Date().toISOString(),

    status,

    scope:
      {
        replays:
          REPLAYS,

        successfulHitCohort:
          hits.length,

        candidateShotPairs:
          allCandidateRows.length,

        successfulHitsWithAtLeastOneCandidate:
          modeledHitsGlobal,

        candidateCoverage:
          rate(
            modeledHitsGlobal,
            hits.length
          ),

        maximumPrecedingTicks:
          MAX_PRECEDING_TICKS,

        maximumPrecedingSeconds:
          MAX_PRECEDING_TICKS /
          TICK_RATE,

        firingOriginZOffsetsHU:
          ORIGIN_Z_OFFSETS_HU,

        rawReplayParsing:
          false,

        directShotAttribution:
          false,

        canonicalProjectileSpeed:
          false
      },

    modelDefinition:
      {
        equation:
          'predictedLatencyTicks = fixedDelayTicks + distanceHU * 64 / speedHUPerSecond',

        speedSearch:
          {
            minimumHUPerSecond:
              MIN_SPEED_HU_PER_SECOND,

            maximumHUPerSecond:
              MAX_SPEED_HU_PER_SECOND,

            gridPoints:
              SPEED_GRID_POINTS,

            spacing:
              'LOGARITHMIC'
          },

        fixedDelayTicks:
          FIXED_DELAY_TICKS,

        perHitAssignment:
          'candidate preceding shot minimizing absolute timing residual under shared hero model',

        robustObjective:
          `mean(min(bestAbsoluteResidualTicks, ${LOSS_CLIP_TICKS}))`,

        ambiguity:
          `unambiguous when second-best residual minus best residual >= ${UNAMBIGUOUS_MARGIN_TICKS} tick`
      },

    replayCounts:
      {
        shots:
          replayShotCounts,

        hits:
          replayHitCounts
      },

    integrity:
      {
        pass:
          integrityPass,

        checks:
          integrityChecks
      },

    heroModels,

    aggregateInterpretation:
      {
        interpretableHeroModels:
          interpretableHeroModels.length,

        finiteTravelModels:
          finiteResolvedHeroModels.length,

        highSpeedTimingResolutionLimitedModels:
          highSpeedLimitedHeroModels.length,

        warning:
          'A fitted finite speed is an empirical latent travel parameter, not yet a canonical weapon projectile velocity.',

        highSpeedWarning:
          'Models near the upper search boundary indicate that 64-tick replay timing cannot cleanly distinguish very high projectile speed from effectively near-instant travel at observed soul distances.',

        attributionWarning:
          'The assigned candidate is the shot most compatible with the shared hero timing model. It is not proven to be the exact source projectile.',

        behavioralUse:
          'No fitted travel parameter should enter the final actionable-opportunity denominator until model quality and weapon-ready state are separately validated.'
      },

    nextStage,

    outputs:
      {
        candidates:
          outputCandidatePath,

        assignments:
          outputAssignmentPath,

        summary:
          outputSummaryPath,

        markdown:
          outputMarkdownPath
      }
  };


// ============================================================
// WRITE SUMMARY
// ============================================================

mkdirSync(
  dirname(
    outputSummaryPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputSummaryPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);


writeFileSync(
  outputMarkdownPath,
  buildMarkdown(
    summary
  ),
  'utf8'
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'HERO-SPECIFIC TRAVEL MODEL SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Successful hits:              ${hits.length}`
);

console.log(
  `Hits with candidate shots:    ${modeledHitsGlobal}/${hits.length} (${formatPercent(rate(modeledHitsGlobal, hits.length))})`
);

console.log(
  `Candidate shot pairs:         ${allCandidateRows.length}`
);

console.log('');

console.log(
  'HERO MODELS'
);

console.log(
  '-----------'
);


for (
  const row
  of heroModels
) {

  if (
    row.status ===
    'INSUFFICIENT_HITS_FOR_MODEL'
  ) {

    console.log(
      `hero=${String(row.heroId).padEnd(4)} ` +
      `hits=${String(row.hits).padEnd(4)} ` +
      `modeled=${String(row.modeledHits).padEnd(4)} ` +
      `replays=${String(row.replayCount).padEnd(2)} ` +
      `status=${row.status}`
    );

    continue;
  }


  console.log(
    `hero=${String(row.heroId).padEnd(4)} ` +
    `hits=${String(row.hits).padEnd(4)} ` +
    `replays=${String(row.replayCount).padEnd(2)} ` +
    `speed=${formatNumber(row.fittedModel.speedHUPerSecond).padEnd(10)} ` +
    `delay=${formatNumber(row.fittedModel.fixedDelayTicks).padEnd(5)} ` +
    `medRes=${formatNumber(row.assignments.residualTicks.median).padEnd(6)} ` +
    `p75Res=${formatNumber(row.assignments.residualTicks.p75).padEnd(6)} ` +
    `rank1=${formatPercent(row.assignments.assignedNearestShotRate).padEnd(8)} ` +
    `unamb=${formatPercent(row.assignments.unambiguousRate).padEnd(8)} ` +
    `status=${row.status}`
  );
}


console.log('');

console.log(
  'INTEGRITY'
);

console.log(
  '---------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    integrityChecks
  )
) {

  console.log(
    `${name.padEnd(42)} ${row.pass} actual=${formatNumber(row.actual)} expected=${row.expected}`
  );
}


console.log('');

console.log(
  'MODEL CLASSES'
);

console.log(
  '-------------'
);

console.log(
  `Finite provisional travel models:       ${finiteResolvedHeroModels.length}`
);

console.log(
  `High-speed / timing-resolution limited:  ${highSpeedLimitedHeroModels.length}`
);

console.log(
  `Total interpretable models:              ${interpretableHeroModels.length}`
);

console.log('');

console.log(
  'FINAL STATUS'
);

console.log(
  '------------'
);

console.log(
  status
);

console.log('');

console.log(
  'NEXT STAGE'
);

console.log(
  '----------'
);

console.log(
  nextStage
);

console.log('');

console.log(
  `Candidates:\n${outputCandidatePath}`
);

console.log('');

console.log(
  `Assignments:\n${outputAssignmentPath}`
);

console.log('');

console.log(
  `Summary:\n${outputSummaryPath}`
);

console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);

console.log('');


// ============================================================
// HERO MODEL FIT
// ============================================================

function fitHeroModel({
  hits,
  speedGrid,
  delayGrid
}) {

  let best =
    null;


  for (
    const speedHUPerSecond
    of speedGrid
  ) {

    for (
      const fixedDelayTicks
      of delayGrid
    ) {

      let totalLoss =
        0;


      let usable =
        0;


      for (
        const hit
        of hits
      ) {

        let bestResidual =
          Infinity;


        for (
          const candidate
          of hit.candidates
        ) {

          const predictedLatencyTicks =
            fixedDelayTicks +
            candidate
              .firingOriginDistanceHU
              .midpoint *
            TICK_RATE /
            speedHUPerSecond;


          const residual =
            Math.abs(
              candidate.latencyTicks -
              predictedLatencyTicks
            );


          if (
            residual <
            bestResidual
          ) {

            bestResidual =
              residual;
          }
        }


        if (
          Number.isFinite(
            bestResidual
          )
        ) {

          totalLoss +=
            Math.min(
              bestResidual,
              LOSS_CLIP_TICKS
            );


          usable++;
        }
      }


      if (
        usable ===
        0
      ) {

        continue;
      }


      const objective =
        totalLoss /
        usable;


      if (
        !best
        ||
        objective <
        best.objective -
        1e-12
        ||
        (
          Math.abs(
            objective -
            best.objective
          ) <=
          1e-12
          &&
          fixedDelayTicks <
          best.fixedDelayTicks
        )
      ) {

        best =
          {
            speedHUPerSecond,
            fixedDelayTicks,
            objective
          };
      }
    }
  }


  if (
    !best
  ) {

    throw new Error(
      'Hero model fit produced no valid model.'
    );
  }


  return best;
}


// ============================================================
// ASSIGNMENT
// ============================================================

function assignHitsUnderModel({
  hits,
  speedHUPerSecond,
  fixedDelayTicks
}) {

  const rows =
    [];


  const residuals =
    [];

  const latencies =
    [];

  const distances =
    [];

  const impliedSpeeds =
    [];

  const ranks =
    [];


  let nearestCount =
    0;


  let unambiguousCount =
    0;


  let withinHalfTick =
    0;


  let withinOneTick =
    0;


  let withinTwoTicks =
    0;


  for (
    const hit
    of hits
  ) {

    const scored =
      hit.candidates
        .map(
          candidate => {

            const predictedLatencyTicks =
              fixedDelayTicks +
              candidate
                .firingOriginDistanceHU
                .midpoint *
              TICK_RATE /
              speedHUPerSecond;


            const residualTicks =
              Math.abs(
                candidate.latencyTicks -
                predictedLatencyTicks
              );


            return {
              candidate,
              predictedLatencyTicks,
              residualTicks
            };
          }
        )
        .sort(
          (
            a,
            b
          ) =>
            a.residualTicks -
            b.residualTicks
            ||
            a.candidate.precedingRank -
            b.candidate.precedingRank
        );


    if (
      scored.length ===
      0
    ) {

      continue;
    }


    const best =
      scored[0];


    const second =
      scored[1]
      ??
      null;


    const margin =
      second
        ? second.residualTicks -
          best.residualTicks
        : null;


    const unambiguous =
      !second
      ||
      margin >=
      UNAMBIGUOUS_MARGIN_TICKS;


    if (
      best.candidate.precedingRank ===
      1
    ) {

      nearestCount++;
    }


    if (
      unambiguous
    ) {

      unambiguousCount++;
    }


    if (
      best.residualTicks <=
      0.5
    ) {

      withinHalfTick++;
    }


    if (
      best.residualTicks <=
      1
    ) {

      withinOneTick++;
    }


    if (
      best.residualTicks <=
      2
    ) {

      withinTwoTicks++;
    }


    residuals.push(
      best.residualTicks
    );


    latencies.push(
      best.candidate.latencyTicks
    );


    distances.push(
      best
        .candidate
        .firingOriginDistanceHU
        .midpoint
    );


    impliedSpeeds.push(
      best
        .candidate
        .impliedSpeedHUPerSecond
    );


    ranks.push(
      best
        .candidate
        .precedingRank
    );


    rows.push(
      {
        schemaVersion:
          1,

        canonical:
          false,

        replay:
          hit.replay,

        hitIndex:
          hit.hitIndex,

        hitKey:
          hit.hitKey,

        eventId:
          hit.eventId,

        playerName:
          hit.playerName,

        heroId:
          hit.heroId,

        hitTick:
          hit.hitTick,

        fittedHeroModel:
          {
            speedHUPerSecond,

            fixedDelayTicks,

            fixedDelaySeconds:
              fixedDelayTicks /
              TICK_RATE
          },

        assignedCandidate:
          {
            shotTick:
              best.candidate.shotTick,

            latencyTicks:
              best.candidate.latencyTicks,

            latencySeconds:
              best.candidate.latencySeconds,

            precedingRank:
              best.candidate.precedingRank,

            weaponEntityIndex:
              best.candidate.weaponEntityIndex,

            weaponSubclassId:
              best.candidate.weaponSubclassId,

            distanceHU:
              best
                .candidate
                .firingOriginDistanceHU,

            impliedSpeedHUPerSecond:
              best
                .candidate
                .impliedSpeedHUPerSecond,

            predictedLatencyTicks:
              best.predictedLatencyTicks,

            residualTicks:
              best.residualTicks
          },

        ambiguity:
          {
            candidateCount:
              scored.length,

            secondBestResidualTicks:
              second?.residualTicks
              ??
              null,

            residualMarginTicks:
              margin,

            unambiguous
          },

        semanticStatus:
          'LATENT_MODEL_COMPATIBLE_SOURCE_SHOT_NOT_DIRECTLY_ATTRIBUTED'
      }
    );
  }


  return {
    rows,

    residualTicks:
      summarizeNumbers(
        residuals
      ),

    latencyTicks:
      summarizeNumbers(
        latencies
      ),

    distanceHU:
      summarizeNumbers(
        distances
      ),

    impliedSpeedHUPerSecond:
      summarizeNumbers(
        impliedSpeeds
      ),

    precedingRank:
      summarizeNumbers(
        ranks
      ),

    nearestCount,

    nearestRate:
      rate(
        nearestCount,
        rows.length
      ),

    unambiguousCount,

    unambiguousRate:
      rate(
        unambiguousCount,
        rows.length
      ),

    withinHalfTick,

    withinHalfTickRate:
      rate(
        withinHalfTick,
        rows.length
      ),

    withinOneTick,

    withinOneTickRate:
      rate(
        withinOneTick,
        rows.length
      ),

    withinTwoTicks,

    withinTwoTicksRate:
      rate(
        withinTwoTicks,
        rows.length
      )
  };
}


// ============================================================
// LEAVE-ONE-REPLAY-OUT VALIDATION
// ============================================================

function buildLeaveOneReplayOutValidation({
  heroHits,
  speedGrid,
  delayGrid
}) {

  const replays =
    [
      ...new Set(
        heroHits.map(
          hit =>
            hit.replay
        )
      )
    ].sort();


  if (
    replays.length <
    2
  ) {

    return {
      available:
        false,

      reason:
        'HERO_PRESENT_IN_ONLY_ONE_REPLAY',

      folds:
        []
    };
  }


  const folds =
    [];


  for (
    const heldOutReplay
    of replays
  ) {

    const training =
      heroHits.filter(
        hit =>
          hit.replay !==
          heldOutReplay
      );


    const test =
      heroHits.filter(
        hit =>
          hit.replay ===
          heldOutReplay
      );


    if (
      training.length <
      MIN_HITS_FOR_MODEL
      ||
      test.length ===
      0
    ) {

      folds.push(
        {
          heldOutReplay,

          available:
            false,

          trainingHits:
            training.length,

          testHits:
            test.length,

          reason:
            'INSUFFICIENT_TRAIN_OR_TEST_SAMPLE'
        }
      );

      continue;
    }


    const fit =
      fitHeroModel({
        hits:
          training,

        speedGrid,

        delayGrid
      });


    const testAssignment =
      assignHitsUnderModel({
        hits:
          test,

        speedHUPerSecond:
          fit.speedHUPerSecond,

        fixedDelayTicks:
          fit.fixedDelayTicks
      });


    folds.push(
      {
        heldOutReplay,

        available:
          true,

        trainingHits:
          training.length,

        testHits:
          test.length,

        trainedModel:
          {
            speedHUPerSecond:
              fit.speedHUPerSecond,

            fixedDelayTicks:
              fit.fixedDelayTicks
          },

        heldOutResidualTicks:
          testAssignment.residualTicks,

        heldOutWithinOneTickRate:
          testAssignment.withinOneTickRate,

        heldOutWithinTwoTicksRate:
          testAssignment.withinTwoTicksRate,

        heldOutUnambiguousRate:
          testAssignment.unambiguousRate
      }
    );
  }


  const availableFolds =
    folds.filter(
      row =>
        row.available
    );


  return {
    available:
      availableFolds.length >
      0,

    folds,

    availableFoldCount:
      availableFolds.length,

    heldOutMedianResidualTicks:
      summarizeNumbers(
        availableFolds
          .map(
            row =>
              row
                .heldOutResidualTicks
                ?.median
          )
      ),

    heldOutWithinOneTickRates:
      summarizeNumbers(
        availableFolds.map(
          row =>
            row.heldOutWithinOneTickRate
        )
      )
  };
}


// ============================================================
// MODEL CLASSIFICATION
// ============================================================

function classifyHeroModel({
  hitCount,
  modeledHitCount,
  speedHUPerSecond,
  residual,
  unambiguousRate
}) {

  if (
    hitCount <
    MIN_HITS_FOR_MODEL
    ||
    modeledHitCount <
    MIN_HITS_FOR_MODEL
  ) {

    return 'INSUFFICIENT_HITS_FOR_MODEL';
  }


  if (
    !Number.isFinite(
      residual?.median
    )
  ) {

    return 'MODEL_UNRESOLVED';
  }


  if (
    speedHUPerSecond >=
    MAX_SPEED_HU_PER_SECOND *
    0.90
  ) {

    if (
      residual.median <=
      1.25
    ) {

      return 'HIGH_SPEED_TIMING_RESOLUTION_LIMITED';
    }


    return 'MODEL_WEAK_OR_UNRESOLVED';
  }


  if (
    residual.median <=
    1
    &&
    (
      residual.p75 ??
      Infinity
    ) <=
    1.75
    &&
    (
      unambiguousRate ??
      0
    ) >=
    0.25
  ) {

    return 'PROVISIONAL_FINITE_TRAVEL_MODEL';
  }


  return 'MODEL_WEAK_OR_UNRESOLVED';
}


function classifyHeroInterpretation({
  modelStatus,
  fit,
  assignment,
  replaySet
}) {

  if (
    modelStatus ===
    'PROVISIONAL_FINITE_TRAVEL_MODEL'
  ) {

    return (
      'A finite common hero-specific timing-distance parameter is compatible ' +
      'with the observed successful hits. Treat the fitted speed as provisional ' +
      'until cross-replay and/or game-resource validation.'
    );
  }


  if (
    modelStatus ===
    'HIGH_SPEED_TIMING_RESOLUTION_LIMITED'
  ) {

    return (
      'Successful-hit timing is compatible with a very fast projectile, but ' +
      '64-tick replay resolution and observed soul distances do not identify ' +
      'a precise upper-end speed. Do not use the fitted boundary value as a constant.'
    );
  }


  if (
    modelStatus ===
    'INSUFFICIENT_HITS_FOR_MODEL'
  ) {

    return (
      'Too few successful soul-hit observations to estimate a hero-specific ' +
      'travel relationship from this cohort.'
    );
  }


  return (
    'Candidate-shot timing does not yet support a sufficiently tight hero-specific ' +
    'travel model. Preserve as unresolved rather than forcing a projectile-speed estimate.'
  );
}


function buildInsufficientHeroSummary({
  heroId,
  heroHits,
  modeledHits,
  replaySet
}) {

  return {
    heroId,

    status:
      'INSUFFICIENT_HITS_FOR_MODEL',

    hits:
      heroHits.length,

    modeledHits:
      modeledHits.length,

    modelCoverage:
      rate(
        modeledHits.length,
        heroHits.length
      ),

    replayCount:
      replaySet.size,

    replays:
      [
        ...replaySet
      ].sort(),

    candidateShotPairs:
      sum(
        modeledHits.map(
          hit =>
            hit.candidates.length
        )
      ),

    candidatesPerHit:
      summarizeNumbers(
        modeledHits.map(
          hit =>
            hit.candidates.length
        )
      ),

    fittedModel:
      null,

    assignments:
      null,

    leaveOneReplayOut:
      {
        available:
          false,

        reason:
          'INSUFFICIENT_HITS_FOR_MODEL',

        folds:
          []
      },

    interpretation:
      'Insufficient successful-hit sample for a hero-specific latent travel model.'
  };
}


// ============================================================
// SHOT COLLECTION
// ============================================================

function collectStrictlyPrecedingShots({
  shots,
  hitTick,
  maximumTicks
}) {

  if (
    shots.length ===
    0
  ) {

    return [];
  }


  const minimumTick =
    hitTick -
    maximumTicks;


  const startIndex =
    lowerBoundShotTick(
      shots,
      minimumTick
    );


  const output =
    [];


  for (
    let index =
      startIndex;

    index <
      shots.length;

    index++
  ) {

    const shot =
      shots[
        index
      ];


    if (
      shot.tick >=
      hitTick
    ) {

      break;
    }


    output.push(
      shot
    );
  }


  return output;
}


function lowerBoundShotTick(
  rows,
  tick
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
      rows[
        mid
      ].tick <
      tick
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


// ============================================================
// SHOT DEDUPLICATION
// ============================================================

function deduplicateShots(
  rows
) {

  const seen =
    new Set();


  const output =
    [];


  for (
    const row
    of rows
  ) {

    const playerName =
      row
        ?.player
        ?.playerName
      ??
      null;


    const tick =
      finite(
        row.tick
      );


    const weaponEntityIndex =
      finite(
        row.weaponEntityIndex
      );


    if (
      !playerName
      ||
      tick ===
      null
    ) {

      continue;
    }


    const key =
      `${playerName}|${tick}|${weaponEntityIndex ?? 'NA'}`;


    if (
      seen.has(
        key
      )
    ) {

      continue;
    }


    seen.add(
      key
    );


    output.push(
      row
    );
  }


  output.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );


  return output;
}


function groupShotsByPlayer(
  shots
) {

  const result =
    new Map();


  for (
    const shot
    of shots
  ) {

    const playerName =
      shot
        ?.player
        ?.playerName
      ??
      null;


    if (
      !playerName
    ) {

      continue;
    }


    if (
      !result.has(
        playerName
      )
    ) {

      result.set(
        playerName,
        []
      );
    }


    result
      .get(
        playerName
      )
      .push(
        shot
      );
  }


  for (
    const rows
    of result.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );
  }


  return result;
}


// ============================================================
// PLAYER POSITION TIMELINES
// ============================================================

async function loadPlayerPositionTimelines(
  path
) {

  const result =
    new Map();


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


    let row;


    try {

      row =
        JSON.parse(
          line
        );

    } catch {

      continue;
    }


    const playerName =
      row
        ?.controller
        ?.playerName
      ??
      null;


    const tick =
      finite(
        row.demoTick
      );


    if (
      !playerName
      ||
      tick ===
      null
    ) {

      continue;
    }


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
      !result.has(
        playerName
      )
    ) {

      result.set(
        playerName,
        []
      );
    }


    result
      .get(
        playerName
      )
      .push(
        {
          tick,
          alive,
          movementValid,
          position
        }
      );
  }


  for (
    const rows
    of result.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );
  }


  return result;
}


function reconstructPlayerPositionAtTick({
  rows,
  tick
}) {

  if (
    rows.length ===
    0
  ) {

    return null;
  }


  const index =
    lowerBoundTimelineTick(
      rows,
      tick
    );


  const after =
    index <
    rows.length
      ? rows[
          index
        ]
      : null;


  const before =
    index >
    0
      ? rows[
          index -
          1
        ]
      : null;


  if (
    after
    &&
    after.tick ===
    tick
    &&
    after.alive
    &&
    after.movementValid
    &&
    after.position
  ) {

    return {
      method:
        'EXACT_4HZ_SAMPLE',

      position:
        after.position
    };
  }


  if (
    before
    &&
    after
    &&
    before.alive
    &&
    after.alive
    &&
    before.movementValid
    &&
    after.movementValid
    &&
    before.position
    &&
    after.position
    &&
    after.tick >
    before.tick
    &&
    after.tick -
    before.tick <=
    16
  ) {

    const fraction =
      (
        tick -
        before.tick
      ) /
      (
        after.tick -
        before.tick
      );


    if (
      fraction >=
      0
      &&
      fraction <=
      1
    ) {

      return {
        method:
          'LINEAR_4HZ_INTERPOLATION',

        position:
          interpolatePosition(
            before.position,
            after.position,
            fraction
          )
      };
    }
  }


  const nearby =
    [
      before,
      after
    ]
      .filter(
        row =>
          row
          &&
          row.alive
          &&
          row.movementValid
          &&
          row.position
          &&
          Math.abs(
            row.tick -
            tick
          ) <=
          8
      )
      .sort(
        (
          a,
          b
        ) =>
          Math.abs(
            a.tick -
            tick
          )
          -
          Math.abs(
            b.tick -
            tick
          )
      );


  if (
    nearby.length ===
    0
  ) {

    return null;
  }


  return {
    method:
      'NEAREST_4HZ_SAMPLE',

    position:
      nearby[0].position
  };
}


function lowerBoundTimelineTick(
  rows,
  tick
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
      rows[
        mid
      ].tick <
      tick
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


// ============================================================
// SPEED GRID
// ============================================================

function buildLogGrid(
  minimum,
  maximum,
  count
) {

  const output =
    [];


  const logMinimum =
    Math.log(
      minimum
    );


  const logMaximum =
    Math.log(
      maximum
    );


  for (
    let index =
      0;

    index <
      count;

    index++
  ) {

    const fraction =
      count ===
      1
        ? 0
        : index /
          (
            count -
            1
          );


    output.push(
      Math.exp(
        logMinimum +
        fraction *
        (
          logMaximum -
          logMinimum
        )
      )
    );
  }


  return output;
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


function writeJsonl(
  path,
  rows
) {

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
  );


  const text =
    rows
      .map(
        row =>
          JSON.stringify(
            row
          )
      )
      .join(
        '\n'
      )
    +
    '\n';


  writeFileSync(
    path,
    text,
    'utf8'
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
      value.X
      ??
      value[0]
    );


  const y =
    finite(
      value.y
      ??
      value.Y
      ??
      value[1]
    );


  const z =
    finite(
      value.z
      ??
      value.Z
      ??
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


function interpolatePosition(
  a,
  b,
  fraction
) {

  return {
    x:
      a.x +
      (
        b.x -
        a.x
      ) *
      fraction,

    y:
      a.y +
      (
        b.y -
        a.y
      ) *
      fraction,

    z:
      a.z +
      (
        b.z -
        a.z
      ) *
      fraction
  };
}


function distance3D(
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
    dx *
    dx +
    dy *
    dy +
    dz *
    dz
  );
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


function sum(
  values
) {

  let total =
    0;


  for (
    const value
    of values
  ) {

    if (
      Number.isFinite(
        value
      )
    ) {

      total +=
        value;
    }
  }


  return total;
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

      p25:
        null,

      median:
        null,

      p75:
        null,

      max:
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
        0.5
      ),

    p75:
      quantile(
        clean,
        0.75
      ),

    max:
      clean[
        clean.length -
        1
      ]
  };
}


function quantile(
  sorted,
  proportion
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
    ) *
    proportion;


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


  return sorted[
    lower
  ] *
    (
      1 -
      weight
    )
    +
    sorted[
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
      ).toFixed(
        2
      )}%`
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


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
  summary
) {

  const lines =
    [];


  lines.push(
    '# Hero-Specific Shot Travel Candidate Models V01'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Scope'
  );

  lines.push('');

  lines.push(
    `- Successful hit cohort: ${summary.scope.successfulHitCohort}`
  );

  lines.push(
    `- Candidate shot pairs: ${summary.scope.candidateShotPairs}`
  );

  lines.push(
    `- Candidate coverage: ${formatPercent(summary.scope.candidateCoverage)}`
  );

  lines.push('');

  lines.push(
    '## Hero models'
  );

  lines.push('');


  for (
    const row
    of summary.heroModels
  ) {

    if (
      !row.fittedModel
    ) {

      lines.push(
        `- Hero ${row.heroId}: hits=${row.hits}, status=${row.status}`
      );

      continue;
    }


    lines.push(
      `- Hero ${row.heroId}: hits=${row.hits}, replays=${row.replayCount}, fittedSpeed=${formatNumber(row.fittedModel.speedHUPerSecond)} HU/s, fixedDelay=${formatNumber(row.fittedModel.fixedDelayTicks)} ticks, medianResidual=${formatNumber(row.assignments.residualTicks.median)} ticks, nearestAssigned=${formatPercent(row.assignments.assignedNearestShotRate)}, unambiguous=${formatPercent(row.assignments.unambiguousRate)}, status=${row.status}`
    );
  }


  lines.push('');

  lines.push(
    '## Guardrails'
  );

  lines.push('');

  lines.push(
    '- The fitted speed is an empirical latent timing-distance parameter, not yet a canonical Deadlock projectile-speed constant.'
  );

  lines.push(
    '- The selected candidate shot is model-compatible, not directly proven to be the projectile that produced the CItemXP Damage event.'
  );

  lines.push(
    '- High-speed models may be unidentifiable at 64 ticks/s and are explicitly labeled timing-resolution limited.'
  );

  lines.push(
    '- These parameters must not yet be used to define final actionable-opportunity denominators.'
  );

  lines.push('');

  lines.push(
    '## Next stage'
  );

  lines.push('');

  lines.push(
    summary.nextStage
  );

  lines.push('');


  return lines.join(
    '\n'
  );
}