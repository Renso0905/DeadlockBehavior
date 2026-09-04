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
  'SOUL_HIT_SHOT_TIMING_PLACEBO_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// Script126 strongly replicated primary-weapon discharge
// telemetry:
//
//   weapon discharge -> known successful CItemXP Damage
//
// But "nearest preceding shot" is NOT automatically the shot
// that hit the soul. Automatic weapon fire can make a recent
// shot common at arbitrary moments.
//
// Script127 therefore compares TRUE soul-hit timing against:
//
//   SAME PLAYER
//   SAME REPLAY
//   SAME SHOT STREAM
//   but shifted PLACEBO hit times:
//
//       ±2 sec
//       ±4 sec
//       ±8 sec
//       ±16 sec
//
// It also compares:
//
//   nearest PRECEDING shot
//   versus
//   nearest FOLLOWING shot
//
// No replay parsing.
// No projectile-speed claim.
// No direct shot->hit attribution.
// No opportunity classification.
// ============================================================


// ============================================================
// CONSTANTS
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


const WINDOWS_TICKS =
  [
    4,
    8,
    16,
    32,
    64
  ];


const MAX_WINDOW_TICKS =
  Math.max(
    ...WINDOWS_TICKS
  );


const PLACEBO_OFFSETS_TICKS =
  [
    -1024,
    -512,
    -256,
    -128,
    128,
    256,
    512,
    1024
  ];


// Only used as descriptive evidence thresholds.
// Failure does NOT invalidate the shot telemetry itself.
const INTERPRETIVE_THRESHOLDS =
  {
    minimumTruePrecedingWithin8Rate:
      0.90,

    minimumTrueMinusPlaceboWithin8:
      0.10,

    minimumTrueMinusPlaceboWithin16:
      0.08
  };


// ============================================================
// OUTPUT PATHS
// ============================================================

const outputJsonPath =
  resolve(
    'output',
    'cross_replay',
    'soul_hit_shot_timing_placebo_validation_v01.json'
  );


const outputMarkdownPath =
  resolve(
    'output',
    'cross_replay',
    'soul_hit_shot_timing_placebo_validation_v01.md'
  );


const outputRowsPath =
  resolve(
    'output',
    'cross_replay',
    'soul_hit_shot_timing_placebo_rows_v01.jsonl'
  );


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'SOUL-HIT SHOT-TIMING PLACEBO VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'Replays:                   rep01-rep05'
);

console.log(
  'True anchors:              successful CItemXP Damage'
);

console.log(
  'Shot stream:               Script126 weapon discharges'
);

console.log(
  'Placebo shifts:            ±2, ±4, ±8, ±16 seconds'
);

console.log(
  'Raw .dem parsing:          NONE'
);

console.log(
  'Direct shot attribution:   NO'
);

console.log(
  'Projectile-speed estimate: NO'
);

console.log('');


// ============================================================
// LOAD FIVE REPLAYS
// ============================================================

const replayData =
  new Map();


let totalTrueAnchors =
  0;


let totalShotEvents =
  0;


for (
  const replay
  of REPLAYS
) {

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


  const summaryPath =
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
      summaryPath
    ]
  ) {

    if (
      !existsSync(
        path
      )
    ) {

      throw new Error(
        `Missing required Script126 output:\n${path}`
      );
    }
  }


  const script126Summary =
    JSON.parse(
      readFileSync(
        summaryPath,
        'utf8'
      )
    );


  if (
    script126Summary?.status !==
    'PRIMARY_WEAPON_SHOT_TELEMETRY_STRONGLY_SUPPORTED'
  ) {

    throw new Error(
      `${replay} Script126 status not ready: ${script126Summary?.status}`
    );
  }


  console.log(
    `Loading ${replay}...`
  );


  const shotsRaw =
    await loadJsonl(
      shotsPath
    );


  const matches =
    await loadJsonl(
      matchesPath
    );


  const shots =
    deduplicateShots(
      shotsRaw
    );


  const shotsByPlayer =
    buildShotsByPlayer(
      shots
    );


  totalTrueAnchors +=
    matches.length;


  totalShotEvents +=
    shots.length;


  replayData.set(
    replay,
    {
      replay,

      shots,

      shotsByPlayer,

      matches,

      script126Summary
    }
  );


  console.log(
    `  shots=${shots.length} anchors=${matches.length} players=${shotsByPlayer.size}`
  );
}


console.log('');

console.log(
  `Total deduplicated shots:  ${totalShotEvents}`
);

console.log(
  `Total true hit anchors:    ${totalTrueAnchors}`
);

console.log('');


// ============================================================
// BUILD TRUE + PLACEBO OBSERVATIONS
// ============================================================

const trueRows =
  [];


const placeboRows =
  [];


for (
  const [
    replay,
    data
  ]
  of replayData
) {

  for (
    let anchorIndex =
      0;

    anchorIndex <
      data.matches.length;

    anchorIndex++
  ) {

    const match =
      data.matches[
        anchorIndex
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


    if (
      !playerName
      ||
      hitTick ===
      null
    ) {

      continue;
    }


    const playerShots =
      data.shotsByPlayer.get(
        playerName
      )
      ??
      [];


    const trueObservation =
      evaluateTimeAgainstShotStream({
        replay,
        observationType:
          'TRUE_HIT',

        anchorIndex,

        playerName,

        heroId,

        referenceTick:
          hitTick,

        trueHitTick:
          hitTick,

        placeboOffsetTicks:
          0,

        shots:
          playerShots
      });


    trueRows.push(
      trueObservation
    );


    for (
      const placeboOffsetTicks
      of PLACEBO_OFFSETS_TICKS
    ) {

      const placeboTick =
        hitTick +
        placeboOffsetTicks;


      const placebo =
        evaluateTimeAgainstShotStream({
          replay,
          observationType:
            'PLACEBO_SHIFTED_TIME',

          anchorIndex,

          playerName,

          heroId,

          referenceTick:
            placeboTick,

          trueHitTick:
            hitTick,

          placeboOffsetTicks,

          shots:
            playerShots
        });


      // A placebo is only considered eligible if the player's
      // shot stream has temporal support on both sides of the
      // shifted reference point. This avoids obvious replay-edge
      // artifacts.
      if (
        placebo.temporalSupport.eligible
      ) {

        placeboRows.push(
          placebo
        );
      }
    }
  }
}


// ============================================================
// POOLED TRUE / PLACEBO SUMMARIES
// ============================================================

const trueSummary =
  summarizeObservationSet(
    trueRows
  );


const placeboSummary =
  summarizeObservationSet(
    placeboRows
  );


const contrasts =
  {};


for (
  const windowTicks
  of WINDOWS_TICKS
) {

  const key =
    String(
      windowTicks
    );


  const trueRate =
    trueSummary
      .preceding
      .withinWindow[
        key
      ]
      .rate;


  const placeboRate =
    placeboSummary
      .preceding
      .withinWindow[
        key
      ]
      .rate;


  contrasts[
    key
  ] =
    {
      windowTicks,

      seconds:
        windowTicks /
        TICK_RATE,

      truePrecedingRate:
        trueRate,

      placeboPrecedingRate:
        placeboRate,

      absoluteDifference:
        Number.isFinite(
          trueRate
        )
        &&
        Number.isFinite(
          placeboRate
        )
          ? trueRate -
            placeboRate
          : null,

      riskRatio:
        Number.isFinite(
          trueRate
        )
        &&
        Number.isFinite(
          placeboRate
        )
        &&
        placeboRate >
        0
          ? trueRate /
            placeboRate
          : null
    };
}


// ============================================================
// PLACEBO BY OFFSET
// ============================================================

const placeboByOffset =
  PLACEBO_OFFSETS_TICKS.map(
    offsetTicks => {

      const rows =
        placeboRows.filter(
          row =>
            row.placeboOffsetTicks ===
            offsetTicks
        );


      return {
        offsetTicks,

        offsetSeconds:
          offsetTicks /
          TICK_RATE,

        observations:
          rows.length,

        summary:
          summarizeObservationSet(
            rows
          )
      };
    }
  );


// ============================================================
// REPLAY SUMMARIES
// ============================================================

const byReplay =
  REPLAYS.map(
    replay => {

      const trueReplayRows =
        trueRows.filter(
          row =>
            row.replay ===
            replay
        );


      const placeboReplayRows =
        placeboRows.filter(
          row =>
            row.replay ===
            replay
        );


      const trueReplay =
        summarizeObservationSet(
          trueReplayRows
        );


      const placeboReplay =
        summarizeObservationSet(
          placeboReplayRows
        );


      return {
        replay,

        trueObservations:
          trueReplayRows.length,

        placeboObservations:
          placeboReplayRows.length,

        true:
          trueReplay,

        placebo:
          placeboReplay,

        precedingWithin8Difference:
          difference(
            trueReplay
              .preceding
              .withinWindow
              ['8']
              .rate,

            placeboReplay
              .preceding
              .withinWindow
              ['8']
              .rate
          ),

        precedingWithin16Difference:
          difference(
            trueReplay
              .preceding
              .withinWindow
              ['16']
              .rate,

            placeboReplay
              .preceding
              .withinWindow
              ['16']
              .rate
          )
      };
    }
  );


// ============================================================
// HERO SUMMARIES
// ============================================================

const heroIds =
  [
    ...new Set(
      trueRows
        .map(
          row =>
            row.heroId
        )
        .filter(
          Number.isFinite
        )
    )
  ]
    .sort(
      (
        a,
        b
      ) =>
        a -
        b
    );


const byHero =
  heroIds
    .map(
      heroId => {

        const heroTrue =
          trueRows.filter(
            row =>
              row.heroId ===
              heroId
          );


        const heroPlacebo =
          placeboRows.filter(
            row =>
              row.heroId ===
              heroId
          );


        const trueHeroSummary =
          summarizeObservationSet(
            heroTrue
          );


        const placeboHeroSummary =
          summarizeObservationSet(
            heroPlacebo
          );


        return {
          heroId,

          trueHits:
            heroTrue.length,

          placeboObservations:
            heroPlacebo.length,

          truePrecedingWithin8Rate:
            trueHeroSummary
              .preceding
              .withinWindow
              ['8']
              .rate,

          placeboPrecedingWithin8Rate:
            placeboHeroSummary
              .preceding
              .withinWindow
              ['8']
              .rate,

          within8Difference:
            difference(
              trueHeroSummary
                .preceding
                .withinWindow
                ['8']
                .rate,

              placeboHeroSummary
                .preceding
                .withinWindow
                ['8']
                .rate
            ),

          truePrecedingWithin16Rate:
            trueHeroSummary
              .preceding
              .withinWindow
              ['16']
              .rate,

          placeboPrecedingWithin16Rate:
            placeboHeroSummary
              .preceding
              .withinWindow
              ['16']
              .rate,

          within16Difference:
            difference(
              trueHeroSummary
                .preceding
                .withinWindow
                ['16']
                .rate,

              placeboHeroSummary
                .preceding
                .withinWindow
                ['16']
                .rate
            ),

          trueNearestPrecedingOffsetTicks:
            trueHeroSummary
              .preceding
              .nearestOffsetTicks,

          placeboNearestPrecedingOffsetTicks:
            placeboHeroSummary
              .preceding
              .nearestOffsetTicks,

          truePreVsPostWithin8Difference:
            difference(
              trueHeroSummary
                .preceding
                .withinWindow
                ['8']
                .rate,

              trueHeroSummary
                .following
                .withinWindow
                ['8']
                .rate
            )
        };
      }
    )
    .sort(
      (
        a,
        b
      ) =>
        b.trueHits -
        a.trueHits
        ||
        a.heroId -
        b.heroId
    );


// ============================================================
// INTEGRITY + INTERPRETIVE CHECKS
// ============================================================

const expectedTrueAnchors =
  529;


const integrityChecks =
  {
    allFiveReplaysLoaded:
      check(
        replayData.size,
        5,
        replayData.size ===
        5
      ),


    successfulHitCohortPreserved:
      check(
        trueRows.length,
        expectedTrueAnchors,
        trueRows.length ===
        expectedTrueAnchors
      ),


    placeboObservationsAvailable:
      check(
        placeboRows.length,
        '>0',
        placeboRows.length >
        0
      ),


    everyTrueAnchorHasPlayerShotTimeline:
      check(
        trueRows.filter(
          row =>
            row.temporalSupport.playerShotCount >
            0
        ).length,
        trueRows.length,
        trueRows.every(
          row =>
            row.temporalSupport.playerShotCount >
            0
        )
      )
  };


const within8Difference =
  contrasts[
    '8'
  ]?.absoluteDifference
  ??
  null;


const within16Difference =
  contrasts[
    '16'
  ]?.absoluteDifference
  ??
  null;


const trueWithin8Rate =
  trueSummary
    .preceding
    .withinWindow
    ['8']
    .rate;


const interpretiveChecks =
  {
    truePrecedingWithin8High:
      check(
        trueWithin8Rate,
        `>=${INTERPRETIVE_THRESHOLDS.minimumTruePrecedingWithin8Rate}`,
        Number.isFinite(
          trueWithin8Rate
        )
        &&
        trueWithin8Rate >=
        INTERPRETIVE_THRESHOLDS.minimumTruePrecedingWithin8Rate
      ),


    trueTimingExceedsPlaceboWithin8:
      check(
        within8Difference,
        `>=${INTERPRETIVE_THRESHOLDS.minimumTrueMinusPlaceboWithin8}`,
        Number.isFinite(
          within8Difference
        )
        &&
        within8Difference >=
        INTERPRETIVE_THRESHOLDS.minimumTrueMinusPlaceboWithin8
      ),


    trueTimingExceedsPlaceboWithin16:
      check(
        within16Difference,
        `>=${INTERPRETIVE_THRESHOLDS.minimumTrueMinusPlaceboWithin16}`,
        Number.isFinite(
          within16Difference
        )
        &&
        within16Difference >=
        INTERPRETIVE_THRESHOLDS.minimumTrueMinusPlaceboWithin16
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


const timingDiscriminative =
  Object
    .values(
      interpretiveChecks
    )
    .every(
      row =>
        row.pass
    );


let status;


let nextStage;


if (
  !integrityPass
) {

  status =
    'SOUL_HIT_SHOT_TIMING_PLACEBO_INTEGRITY_FAILURE';


  nextStage =
    'DIAGNOSE_SCRIPT126_CROSS_REPLAY_INPUTS';

} else if (
  timingDiscriminative
) {

  status =
    'SOUL_HIT_SHOT_TIMING_EXCEEDS_SAME_PLAYER_PLACEBO';


  nextStage =
    'BUILD_HERO_SPECIFIC_CANDIDATE_SHOT_ASSIGNMENT_AND_TRAVEL_MODEL';

} else {

  status =
    'NEAREST_PRECEDING_SHOT_TIMING_NOT_SUFFICIENTLY_DISCRIMINATIVE';


  nextStage =
    'DO_NOT_INFER_PROJECTILE_SPEED_FROM_NEAREST_SHOT_USE_WEAPON_RESOURCE_OR_STRONGER_ASSIGNMENT_SIGNAL';
}


// ============================================================
// OUTPUT ROWS
// ============================================================

const combinedRows =
  [
    ...trueRows,
    ...placeboRows
  ];


writeJsonl(
  outputRowsPath,
  combinedRows
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

        trueSuccessfulHitAnchors:
          trueRows.length,

        placeboObservations:
          placeboRows.length,

        placeboOffsetsTicks:
          PLACEBO_OFFSETS_TICKS,

        placeboOffsetsSeconds:
          PLACEBO_OFFSETS_TICKS.map(
            value =>
              value /
              TICK_RATE
          ),

        rawReplayParsing:
          false,

        directShotToHitAttribution:
          false,

        projectileSpeedCalibration:
          false
      },

    pooled:
      {
        true:
          trueSummary,

        placebo:
          placeboSummary,

        contrasts
      },

    placeboByOffset,

    byReplay,

    byHero,

    integrity:
      {
        pass:
          integrityPass,

        checks:
          integrityChecks
      },

    interpretiveEvidence:
      {
        timingDiscriminative,

        thresholds:
          INTERPRETIVE_THRESHOLDS,

        checks:
          interpretiveChecks
      },

    interpretation:
      {
        ifTimingExceedsPlacebo:
          'Successful CItemXP impacts occur unusually soon after same-player weapon discharge compared with shifted times from the same player and replay. This supports using discharge timing as a source-shot assignment signal, but does not itself prove which specific shot produced the hit.',

        ifTimingDoesNotExceedPlacebo:
          'A recent same-player shot is too common during ordinary firing to identify source shots reliably by nearest-preceding timing alone. Weapon-resource mechanics or a stronger physical assignment model is required.',

        precedingVsFollowing:
          'Preceding-versus-following comparisons are descriptive because sustained automatic fire can continue through and after the soul impact.',

        placeboMeaning:
          'Shifted controls preserve player identity, hero, replay, and the player-specific firing stream while removing the exact soul-impact time relationship.',

        guardrail:
          'No value produced here is a canonical projectile velocity or exact shot-to-hit attribution.'
      },

    nextStage,

    outputs:
      {
        json:
          outputJsonPath,

        markdown:
          outputMarkdownPath,

        rows:
          outputRowsPath
      }
  };


// ============================================================
// WRITE SUMMARY
// ============================================================

mkdirSync(
  dirname(
    outputJsonPath
  ),
  {
    recursive:
      true
  }
);


writeFileSync(
  outputJsonPath,
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

console.log(
  '========================================================'
);

console.log(
  'TRUE VS PLACEBO SHOT TIMING'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `True hit anchors:       ${trueRows.length}`
);

console.log(
  `Eligible placebos:      ${placeboRows.length}`
);

console.log('');

console.log(
  'PRECEDING SHOT ALIGNMENT'
);

console.log(
  '------------------------'
);


for (
  const windowTicks
  of WINDOWS_TICKS
) {

  const key =
    String(
      windowTicks
    );


  const contrast =
    contrasts[
      key
    ];


  console.log(
    `within ${String(windowTicks).padStart(2)} ticks ` +
    `(${contrast.seconds.toFixed(3)}s): ` +
    `true=${formatPercent(contrast.truePrecedingRate).padEnd(8)} ` +
    `placebo=${formatPercent(contrast.placeboPrecedingRate).padEnd(8)} ` +
    `diff=${formatSignedPercent(contrast.absoluteDifference).padEnd(9)} ` +
    `RR=${formatNumber(contrast.riskRatio)}`
  );
}


console.log('');

console.log(
  'NEAREST PRECEDING OFFSET'
);

console.log(
  '------------------------'
);


console.log(
  `true:    ${formatDistribution(
    trueSummary
      .preceding
      .nearestOffsetTicks
  )}`
);

console.log(
  `placebo: ${formatDistribution(
    placeboSummary
      .preceding
      .nearestOffsetTicks
  )}`
);

console.log('');

console.log(
  'TRUE-TIME PRECEDING VS FOLLOWING'
);

console.log(
  '--------------------------------'
);


for (
  const windowTicks
  of WINDOWS_TICKS
) {

  const key =
    String(
      windowTicks
    );


  const preceding =
    trueSummary
      .preceding
      .withinWindow[
        key
      ]
      .rate;


  const following =
    trueSummary
      .following
      .withinWindow[
        key
      ]
      .rate;


  console.log(
    `within ${String(windowTicks).padStart(2)} ticks: ` +
    `preceding=${formatPercent(preceding).padEnd(8)} ` +
    `following=${formatPercent(following).padEnd(8)} ` +
    `diff=${formatSignedPercent(
      difference(
        preceding,
        following
      )
    )}`
  );
}


console.log('');

console.log(
  'BY REPLAY'
);

console.log(
  '---------'
);


for (
  const row
  of byReplay
) {

  console.log(
    `${row.replay.padEnd(7)} ` +
    `hits=${String(row.trueObservations).padEnd(4)} ` +
    `placebos=${String(row.placeboObservations).padEnd(5)} ` +
    `true8=${formatPercent(row.true.preceding.withinWindow['8'].rate).padEnd(8)} ` +
    `plac8=${formatPercent(row.placebo.preceding.withinWindow['8'].rate).padEnd(8)} ` +
    `diff8=${formatSignedPercent(row.precedingWithin8Difference)}`
  );
}


console.log('');

console.log(
  'BY HERO (>=5 TRUE HITS)'
);

console.log(
  '-----------------------'
);


for (
  const row
  of byHero.filter(
    row =>
      row.trueHits >=
      5
  )
) {

  console.log(
    `hero=${String(row.heroId).padEnd(4)} ` +
    `hits=${String(row.trueHits).padEnd(4)} ` +
    `true8=${formatPercent(row.truePrecedingWithin8Rate).padEnd(8)} ` +
    `plac8=${formatPercent(row.placeboPrecedingWithin8Rate).padEnd(8)} ` +
    `diff8=${formatSignedPercent(row.within8Difference).padEnd(9)} ` +
    `true16=${formatPercent(row.truePrecedingWithin16Rate).padEnd(8)} ` +
    `plac16=${formatPercent(row.placeboPrecedingWithin16Rate).padEnd(8)}`
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
    `${name.padEnd(46)} ${row.pass}`
  );
}


console.log('');

console.log(
  'INTERPRETIVE EVIDENCE'
);

console.log(
  '---------------------'
);


for (
  const [
    name,
    row
  ]
  of Object.entries(
    interpretiveChecks
  )
) {

  console.log(
    `${name.padEnd(46)} ${row.pass} actual=${formatNumber(row.actual)} expected=${row.expected}`
  );
}


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
  `JSON:\n${outputJsonPath}`
);

console.log('');

console.log(
  `Rows:\n${outputRowsPath}`
);

console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);

console.log('');


// ============================================================
// OBSERVATION EVALUATION
// ============================================================

function evaluateTimeAgainstShotStream({
  replay,
  observationType,
  anchorIndex,
  playerName,
  heroId,
  referenceTick,
  trueHitTick,
  placeboOffsetTicks,
  shots
}) {

  const preceding =
    nearestPrecedingShot({
      shots,
      tick:
        referenceTick
    });


  const following =
    nearestFollowingShot({
      shots,
      tick:
        referenceTick
    });


  const precedingOffsetTicks =
    preceding
      ? referenceTick -
        preceding.tick
      : null;


  const followingOffsetTicks =
    following
      ? following.tick -
        referenceTick
      : null;


  const minShotTick =
    shots.length >
    0
      ? shots[0].tick
      : null;


  const maxShotTick =
    shots.length >
    0
      ? shots[
          shots.length -
          1
        ].tick
      : null;


  const eligible =
    Number.isFinite(
      minShotTick
    )
    &&
    Number.isFinite(
      maxShotTick
    )
    &&
    referenceTick -
    MAX_WINDOW_TICKS >=
    minShotTick
    &&
    referenceTick +
    MAX_WINDOW_TICKS <=
    maxShotTick;


  const precedingWithin =
    {};


  const followingWithin =
    {};


  for (
    const windowTicks
    of WINDOWS_TICKS
  ) {

    precedingWithin[
      String(
        windowTicks
      )
    ] =
      Number.isFinite(
        precedingOffsetTicks
      )
      &&
      precedingOffsetTicks >=
      0
      &&
      precedingOffsetTicks <=
      windowTicks;


    followingWithin[
      String(
        windowTicks
      )
    ] =
      Number.isFinite(
        followingOffsetTicks
      )
      &&
      followingOffsetTicks >=
      0
      &&
      followingOffsetTicks <=
      windowTicks;
  }


  return {
    schemaVersion:
      1,

    canonical:
      false,

    replay,

    observationType,

    anchorIndex,

    playerName,

    heroId,

    trueHitTick,

    referenceTick,

    placeboOffsetTicks,

    placeboOffsetSeconds:
      placeboOffsetTicks /
      TICK_RATE,

    temporalSupport:
      {
        eligible,

        playerShotCount:
          shots.length,

        minimumShotTick:
          minShotTick,

        maximumShotTick:
          maxShotTick
      },

    preceding:
      {
        shotTick:
          preceding?.tick
          ??
          null,

        offsetTicks:
          precedingOffsetTicks,

        offsetSeconds:
          Number.isFinite(
            precedingOffsetTicks
          )
            ? precedingOffsetTicks /
              TICK_RATE
            : null,

        weaponEntityIndex:
          preceding?.weaponEntityIndex
          ??
          null,

        shotSignalConfidence:
          preceding
            ?.signal
            ?.confidence
          ??
          null,

        within:
          precedingWithin
      },

    following:
      {
        shotTick:
          following?.tick
          ??
          null,

        offsetTicks:
          followingOffsetTicks,

        offsetSeconds:
          Number.isFinite(
            followingOffsetTicks
          )
            ? followingOffsetTicks /
              TICK_RATE
            : null,

        weaponEntityIndex:
          following?.weaponEntityIndex
          ??
          null,

        shotSignalConfidence:
          following
            ?.signal
            ?.confidence
          ??
          null,

        within:
          followingWithin
      }
  };
}


// ============================================================
// SUMMARIZATION
// ============================================================

function summarizeObservationSet(
  rows
) {

  const precedingOffsets =
    rows
      .map(
        row =>
          row
            ?.preceding
            ?.offsetTicks
      );


  const followingOffsets =
    rows
      .map(
        row =>
          row
            ?.following
            ?.offsetTicks
      );


  const precedingWithinWindow =
    {};


  const followingWithinWindow =
    {};


  for (
    const windowTicks
    of WINDOWS_TICKS
  ) {

    const key =
      String(
        windowTicks
      );


    const precedingCount =
      rows.filter(
        row =>
          row
            ?.preceding
            ?.within
            ?.[
              key
            ] ===
          true
      ).length;


    const followingCount =
      rows.filter(
        row =>
          row
            ?.following
            ?.within
            ?.[
              key
            ] ===
          true
      ).length;


    precedingWithinWindow[
      key
    ] =
      {
        count:
          precedingCount,

        total:
          rows.length,

        rate:
          rate(
            precedingCount,
            rows.length
          )
      };


    followingWithinWindow[
      key
    ] =
      {
        count:
          followingCount,

        total:
          rows.length,

        rate:
          rate(
            followingCount,
            rows.length
          )
      };
  }


  return {
    observations:
      rows.length,

    preceding:
      {
        nearestOffsetTicks:
          summarizeNumbers(
            precedingOffsets
          ),

        nearestOffsetSeconds:
          summarizeNumbers(
            precedingOffsets.map(
              value =>
                Number.isFinite(
                  value
                )
                  ? value /
                    TICK_RATE
                  : null
            )
          ),

        withinWindow:
          precedingWithinWindow
      },

    following:
      {
        nearestOffsetTicks:
          summarizeNumbers(
            followingOffsets
          ),

        nearestOffsetSeconds:
          summarizeNumbers(
            followingOffsets.map(
              value =>
                Number.isFinite(
                  value
                )
                  ? value /
                    TICK_RATE
                  : null
            )
          ),

        withinWindow:
          followingWithinWindow
      }
  };
}


// ============================================================
// SHOT STREAM
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
        row?.tick
      );


    const weaponEntityIndex =
      finite(
        row?.weaponEntityIndex
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
      ||
      String(
        a
          ?.player
          ?.playerName
        ??
        ''
      ).localeCompare(
        String(
          b
            ?.player
            ?.playerName
          ??
          ''
        )
      )
  );


  return output;
}


function buildShotsByPlayer(
  rows
) {

  const result =
    new Map();


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
        row
      );
  }


  for (
    const shots
    of result.values()
  ) {

    shots.sort(
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


function nearestPrecedingShot({
  shots,
  tick
}) {

  if (
    shots.length ===
    0
  ) {

    return null;
  }


  let low =
    0;


  let high =
    shots.length;


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
      shots[
        mid
      ].tick <=
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


  const index =
    low -
    1;


  return index >=
    0
      ? shots[
          index
        ]
      : null;
}


function nearestFollowingShot({
  shots,
  tick
}) {

  if (
    shots.length ===
    0
  ) {

    return null;
  }


  let low =
    0;


  let high =
    shots.length;


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
      shots[
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


  return low <
    shots.length
      ? shots[
          low
        ]
      : null;
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


function difference(
  a,
  b
) {

  return Number.isFinite(
    a
  )
  &&
  Number.isFinite(
    b
  )
    ? a -
      b
    : null;
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


function formatSignedPercent(
  value
) {

  if (
    !Number.isFinite(
      value
    )
  ) {

    return 'n/a';
  }


  const percentage =
    value *
    100;


  return `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}pp`;
}


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
    '# Soul-Hit Shot-Timing Placebo Validation'
  );

  lines.push('');

  lines.push(
    `Status: **${summary.status}**`
  );

  lines.push('');

  lines.push(
    '## Purpose'
  );

  lines.push('');

  lines.push(
    'Determine whether the strong nearest-preceding-shot alignment observed in Script126 is specific to actual CItemXP impact timing or merely reflects frequent ordinary weapon fire.'
  );

  lines.push('');

  lines.push(
    '## Pooled true versus placebo'
  );

  lines.push('');


  for (
    const contrast
    of Object.values(
      summary
        .pooled
        .contrasts
    )
  ) {

    lines.push(
      `- Within ${contrast.windowTicks} ticks (${contrast.seconds.toFixed(3)} s): true=${formatPercent(contrast.truePrecedingRate)}, placebo=${formatPercent(contrast.placeboPrecedingRate)}, difference=${formatSignedPercent(contrast.absoluteDifference)}`
    );
  }


  lines.push('');

  lines.push(
    '## Guardrail'
  );

  lines.push('');

  lines.push(
    'Even strong true-versus-placebo discrimination does not prove that the nearest preceding shot was the projectile that hit the soul. It only establishes that weapon-discharge timing contains target-relevant signal beyond the player’s ordinary firing rate.'
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