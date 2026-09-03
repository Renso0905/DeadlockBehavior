import {
  createReadStream,
  createWriteStream,
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

import {
  Parser,
  InterceptorStage
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ?? 'test';


const TICK_RATE =
  64;


const MATCH_CLOCK_OFFSET_SECONDS =
  30;


// ============================================================
// CITEMXP SUBCLASS FINGERPRINTS
// ============================================================

const TROOPER_ORB_SUBCLASS =
  '494398941';


const URN_ORB_SUBCLASS =
  '3283937835';


const FIXED_SITE_SUBCLASS =
  '828604450';


const URN_CLASS =
  'CCitadelItemPickupIdol';


// ============================================================
// URN PAYOUT BURST SIGNATURE
//
// Script 59 showed the 3283937835 family appearing as tightly
// clustered ~10-orb sequences.
//
// We deliberately classify ONLY this subclass here.
// ============================================================

const BURST_MAX_SEQUENTIAL_GAP_TICKS =
  48;
// 0.75 sec


const BURST_MAX_CENTROID_DISTANCE =
  128;


const BURST_MIN_ORBS =
  8;


const BURST_MAX_ORBS =
  16;


const BURST_MAX_SPAN_TICKS =
  256;
// 4 sec


const BURST_MAX_RADIUS =
  96;


const EXPECTED_ATTACKABLE_MIN =
  2.8;


const EXPECTED_ATTACKABLE_MAX =
  3.2;


// ============================================================
// URN ENTITY CORRELATION
//
// Carried Idol telemetry can disappear before payout orbs
// become attackable, so this is supportive evidence rather
// than the sole classification criterion.
// ============================================================

const URN_EVENT_WINDOW_TICKS =
  12 *
  TICK_RATE;


const URN_EVENT_MAX_DISTANCE =
  2500;


const STRONG_URN_EVENT_TIME_TICKS =
  5 *
  TICK_RATE;


const STRONG_URN_EVENT_DISTANCE =
  1500;


// ============================================================
// PATHS
// ============================================================

const episodeInputPath =
  resolve(
    'output',
    replayName,
    'citemxp_source_classification_v01.jsonl'
  );


const sourceSummaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_source_classification_v01.json'
  );


const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const summaryPath =
  resolve(
    'output',
    replayName,
    'urn_citemxp_subclass_validation_v01.json'
  );


const burstPath =
  resolve(
    'output',
    replayName,
    'urn_citemxp_bursts_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    episodeInputPath,
    sourceSummaryPath,
    replayPath
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
// LOAD SCRIPT 59 SUMMARY
// ============================================================

const sourceSummary =
  JSON.parse(
    readFileSync(
      sourceSummaryPath,
      'utf8'
    )
  );


if (
  sourceSummary
    ?.validation
    ?.pass !==
  true
) {

  throw new Error(
    'Script 59 source classification did not PASS.'
  );
}


// ============================================================
// LOAD CITEMXP EPISODES
// ============================================================

console.log('');

console.log(
  'Loading CItemXP episodes...'
);


const rawRows =
  await loadJsonl(
    episodeInputPath
  );


const episodes =
  rawRows
    .map(
      normalizeEpisodeRow
    )
    .filter(
      Boolean
    );


console.log(
  `Episodes: ${episodes.length}`
);


// ============================================================
// SPLIT BY SUBCLASS
// ============================================================

const bySubclass =
  countBy(
    episodes,
    row =>
      row.subclassId
  );


const trooperFamily =
  episodes.filter(
    row =>
      row.subclassId ===
      TROOPER_ORB_SUBCLASS
  );


const urnFamily =
  episodes.filter(
    row =>
      row.subclassId ===
      URN_ORB_SUBCLASS
  );


const fixedSiteFamily =
  episodes.filter(
    row =>
      row.subclassId ===
      FIXED_SITE_SUBCLASS
  );


console.log(
  `Trooper-family ${TROOPER_ORB_SUBCLASS}: ${trooperFamily.length}`
);


console.log(
  `Urn candidate ${URN_ORB_SUBCLASS}: ${urnFamily.length}`
);


console.log(
  `Fixed-site candidate ${FIXED_SITE_SUBCLASS}: ${fixedSiteFamily.length}`
);


// ============================================================
// BUILD 3283937835 BURSTS
// ============================================================

const urnBursts =
  buildSequentialBursts(
    urnFamily
  )
    .map(
      (
        rows,
        index
      ) =>
        summarizeBurst(
          rows,
          index
        )
    );


const highConfidenceBursts =
  urnBursts.filter(
    row =>
      row.structuralSignaturePass
  );


console.log(
  `Urn-subclass bursts: ${urnBursts.length}`
);


console.log(
  `Structural payout bursts: ${highConfidenceBursts.length}`
);


// ============================================================
// ONLY PARSE URN ENTITY TELEMETRY NEAR THOSE BURSTS
// ============================================================

const relevantTickRanges =
  highConfidenceBursts.map(
    burst => ({

      min:
        burst.firstTick -
        URN_EVENT_WINDOW_TICKS,

      max:
        burst.lastTick +
        URN_EVENT_WINDOW_TICKS
    })
  );


const urnEvents =
  [];


const previousUrnState =
  new Map();


let urnEntityPackets =
  0;


let urnRelevantEvents =
  0;


if (
  relevantTickRanges.length >
  0
) {

  console.log(
    'Scanning Soul Urn entity telemetry around candidate payout bursts...'
  );


  const parser =
    new Parser();


  parser.registerPostInterceptor(

    InterceptorStage.ENTITY_PACKET,

    (
      demoPacket,
      messagePacket,
      events
    ) => {

      const tick =
        finite(
          demoPacket?.tick
        );


      if (
        tick ===
          null
        ||
        !tickInsideAnyRange(
          tick,
          relevantTickRanges
        )
      ) {

        return;
      }


      for (
        const event
        of events
        ??
        []
      ) {

        const entity =
          event.entity;


        if (
          !entity
          ||
          getEntityClassName(
            entity
          ) !==
          URN_CLASS
        ) {

          continue;
        }


        urnEntityPackets++;


        const entityIndex =
          getEntityIndex(
            entity
          );


        if (
          entityIndex ===
          null
        ) {

          continue;
        }


        const operation =
          decodeOperation(
            event.operation
          );


        const changedFields =
          extractChangedFields(
            safeGetChanges(
              event
            )
          );


        const position =
          getBestPosition(
            entity
          );


        const team =
          finite(
            safeGetField(
              entity,
              'm_iTeamNum'
            )
          );


        const owner =
          serializeScalar(
            safeGetField(
              entity,
              'm_hOwner'
            )
          );


        const ownerEntity =
          serializeScalar(
            safeGetField(
              entity,
              'm_hOwnerEntity'
            )
          );


        const previous =
          previousUrnState.get(
            entityIndex
          )
          ??
          null;


        const ownerChanged =
          Boolean(
            previous
            &&
            (
              previous.owner !==
                owner
              ||
              previous.ownerEntity !==
                ownerEntity
            )
          );


        const teamChanged =
          Boolean(
            previous
            &&
            previous.team !==
              team
          );


        const positionJump =
          Boolean(
            previous?.position
            &&
            position
            &&
            getDistance3D(
              previous.position,
              position
            ) >=
            128
          );


        const deliveryLikeFieldChange =
          changedFields.some(
            name =>
              /(deliver|deposit|score|owner|carrier|carry|pickup|team|active|state|drop|return)/i.test(
                name
              )
          );


        const meaningful =
          operation !==
            'UPDATE'
          ||
          ownerChanged
          ||
          teamChanged
          ||
          positionJump
          ||
          deliveryLikeFieldChange;


        if (
          meaningful
        ) {

          urnRelevantEvents++;


          urnEvents.push({

            tick,

            timeSeconds:
              tickToMatchTime(
                tick
              ),

            clock:
              formatClock(
                tickToMatchTime(
                  tick
                )
              ),

            entityIndex,

            operation,

            team,

            position,

            owner,

            ownerEntity,

            ownerChanged,

            teamChanged,

            positionJump,

            deliveryLikeFieldChange,

            changedFields
          });
        }


        previousUrnState.set(
          entityIndex,
          {

            tick,

            team,

            owner,

            ownerEntity,

            position
          }
        );
      }
    }
  );


  await parser.parse(
    createReadStream(
      replayPath
    )
  );


  await parser.dispose();
}


// ============================================================
// CORRELATE EACH 328 BURST TO URN ENTITY TELEMETRY
// ============================================================

for (
  const burst
  of urnBursts
) {

  burst.urnCorrelation =
    correlateUrnEvents(
      burst,
      urnEvents
    );
}


const strongCorrelatedBursts =
  highConfidenceBursts.filter(
    burst =>
      burst
        .urnCorrelation
        ?.strong ===
      true
  );


// ============================================================
// SPATIAL SITE FINGERPRINT
// ============================================================

const siteGroups =
  buildSiteGroups(
    highConfidenceBursts
  );


const sideCounts =
  countBy(

    highConfidenceBursts,

    burst =>
      burst.centroid
        ? (
          burst.centroid.x <
            0
            ? 'NEGATIVE_X'
            : 'POSITIVE_X'
        )
        : 'UNKNOWN'
  );


// ============================================================
// TIMING FINGERPRINTS
// ============================================================

const trooperTiming =
  summarizeTiming(
    trooperFamily
  );


const urnTiming =
  summarizeTiming(
    urnFamily
  );


const fixedTiming =
  summarizeTiming(
    fixedSiteFamily
  );


// ============================================================
// VALIDATION
// ============================================================

const payoutOrbMedian =
  summarizeNumbers(
    highConfidenceBursts.map(
      row =>
        row.orbCount
    )
  ).median;


const payoutAttackableMedian =
  summarizeNumbers(
    highConfidenceBursts.map(
      row =>
        row.attackableDurationMedian
    )
  ).median;


const validation =
  {

    source59Passed:
      check(
        sourceSummary
          ?.validation
          ?.pass,
        true,
        sourceSummary
          ?.validation
          ?.pass ===
        true
      ),


    episodesLoaded:
      check(
        episodes.length,
        '>0',
        episodes.length >
        0
      ),


    urnSubclassObserved:
      check(
        urnFamily.length,
        '>0',
        urnFamily.length >
        0
      ),


    structuralUrnBurstsObserved:
      check(
        highConfidenceBursts.length,
        '>0',
        highConfidenceBursts.length >
        0
      ),


    payoutOrbCountNearTen:
      check(
        payoutOrbMedian,
        '8..16 and expected near 10',
        Number.isFinite(
          payoutOrbMedian
        )
        &&
        payoutOrbMedian >=
          8
        &&
        payoutOrbMedian <=
          16
      ),


    urnAttackableWindowNearThreeSeconds:
      check(
        payoutAttackableMedian,
        '2.8..3.2 sec',
        Number.isFinite(
          payoutAttackableMedian
        )
        &&
        payoutAttackableMedian >=
          EXPECTED_ATTACKABLE_MIN
        &&
        payoutAttackableMedian <=
          EXPECTED_ATTACKABLE_MAX
      ),


    distinctFromTrooperSubclass:
      check(
        URN_ORB_SUBCLASS,
        `!= ${TROOPER_ORB_SUBCLASS}`,
        URN_ORB_SUBCLASS !==
        TROOPER_ORB_SUBCLASS
      )
  };


const validationPass =
  Object
    .values(
      validation
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// INTERPRETATION
// ============================================================

let interpretation =
  'URN_CITEMXP_SUBCLASS_CANDIDATE';


if (
  validationPass
) {

  interpretation =
    'CITEMXP_3283937835_STRONGLY_SUPPORTED_AS_SOUL_URN_PAYOUT_ORB';
}


if (
  validationPass
  &&
  strongCorrelatedBursts.length >
  0
) {

  interpretation =
    'CITEMXP_3283937835_STRONGLY_SUPPORTED_AS_SOUL_URN_PAYOUT_ORB_WITH_DIRECT_IDOL_CORRELATION';
}


// ============================================================
// OUTPUT DIRECTORY
// ============================================================

mkdirSync(
  dirname(
    summaryPath
  ),
  {
    recursive:
      true
  }
);


// ============================================================
// WRITE BURSTS
// ============================================================

const burstWriter =
  createWriteStream(
    burstPath,
    {
      encoding:
        'utf8'
    }
  );


for (
  const burst
  of urnBursts
) {

  burstWriter.write(
    JSON.stringify({

      schemaVersion:
        1,

      canonical:
        false,

      interpretation,

      ...burst
    })
    +
    '\n'
  );
}


await finishWriter(
  burstWriter
);


// ============================================================
// SUMMARY
// ============================================================

const summary =
  {

    replay:
      replayName,

    version:
      'URN_CITEMXP_SUBCLASS_VALIDATION_V01',

    canonical:
      false,

    status:
      validationPass
        ? 'STRONG_WORKING_IDENTIFICATION'
        : 'DIAGNOSTIC_ONLY',

    interpretation,


    correctionToScript59:
      {

        issue:
          'The Script 59 generic multi-orb burst heuristic was too permissive and mixed several CItemXP subclasses into the Urn candidate pool.',

        consequence:
          'The aggregate dominant Urn subclass from Script 59 must not be used.',

        replacementRule:
          `Treat subclass ${URN_ORB_SUBCLASS} as the dedicated Soul Urn payout-orb candidate and validate it by its own burst morphology.`
      },


    subclassInventory:
      mapToSortedObject(
        bySubclass
      ),


    fingerprints:
      {

        trooperFlyingOrb:
          {

            subclassId:
              TROOPER_ORB_SUBCLASS,

            episodeCount:
              trooperFamily.length,

            script59OneToOneTrooperMatches:
              sourceSummary
                ?.trooperSource
                ?.matchedCItemXPEpisodes
              ??
              null,

            script59ExactTickRate:
              sourceSummary
                ?.trooperSource
                ?.exactTickRate
              ??
              null,

            script59SameTeamRate:
              sourceSummary
                ?.trooperSource
                ?.sameTeamRate
              ??
              null,

            script59MedianXY:
              sourceSummary
                ?.trooperSource
                ?.geometry
                ?.distanceXY
                ?.median
              ??
              null,

            timing:
              trooperTiming
          },


        soulUrnPayoutCandidate:
          {

            subclassId:
              URN_ORB_SUBCLASS,

            episodeCount:
              urnFamily.length,

            burstCount:
              urnBursts.length,

            structuralPayoutBursts:
              highConfidenceBursts.length,

            strongIdolCorrelations:
              strongCorrelatedBursts.length,

            burstOrbCount:
              summarizeNumbers(
                highConfidenceBursts.map(
                  row =>
                    row.orbCount
                )
              ),

            burstSpanSeconds:
              summarizeNumbers(
                highConfidenceBursts.map(
                  row =>
                    row.tickSpan /
                    TICK_RATE
                )
              ),

            burstRadius:
              summarizeNumbers(
                highConfidenceBursts.map(
                  row =>
                    row.maxRadius
                )
              ),

            timing:
              urnTiming,

            sideCounts:
              mapToSortedObject(
                sideCounts
              ),

            spatialSites:
              siteGroups
          },


        fixedSiteNonUrnCandidate:
          {

            subclassId:
              FIXED_SITE_SUBCLASS,

            episodeCount:
              fixedSiteFamily.length,

            timing:
              fixedTiming,

            note:
              'Script 59 frequently grouped this subclass into compact bursts, but its approximately 0.3-second attackable window and repeated fixed-site behavior are distinct from the 3-second Urn payout pattern.'
          }
      },


    urnEntityCorrelation:
      {

        scannedEntityPackets:
          urnEntityPackets,

        meaningfulEvents:
          urnRelevantEvents,

        strongCorrelatedBursts:
          strongCorrelatedBursts.length,

        note:
          'Direct CCitadelItemPickupIdol correlation is supportive but not required for the subtype fingerprint because carried/delivered Idol lifecycle timing may precede the visible payout burst.'
      },


    bursts:
      urnBursts,


    validation:
      {

        pass:
          validationPass,

        checks:
          validation
      },


    nextStep:
      validationPass

        ? `Use subclass ${TROOPER_ORB_SUBCLASS} for Trooper secure/deny outcome reconstruction and subclass ${URN_ORB_SUBCLASS} for Urn claim/deny/auto-award reconstruction. Do not use Script 59's generic URN_BURST_CANDIDATE labels.`

        : 'Inspect failed burst-signature checks before promoting the Urn subtype.',


    outputs:
      {

        summary:
          summaryPath,

        bursts:
          burstPath
      }
  };


// ============================================================
// WRITE SUMMARY
// ============================================================

writeFileSync(

  summaryPath,

  JSON.stringify(
    summary,
    null,
    2
  ),

  'utf8'
);


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
  '========================================='
);

console.log(
  'URN CITEMXP SUBCLASS VALIDATION RESULTS'
);

console.log(
  '========================================='
);

console.log('');

console.log(
  `Subclass ${URN_ORB_SUBCLASS} episodes: ${urnFamily.length}`
);

console.log(
  `Structural payout bursts: ${highConfidenceBursts.length}`
);

console.log(
  `Strong Idol correlations: ${strongCorrelatedBursts.length}`
);

console.log(
  `Median payout orb count: ${formatNumber(
    payoutOrbMedian
  )}`
);

console.log(
  `Median payout burst span: ${formatNumber(
    summarizeNumbers(
      highConfidenceBursts.map(
        row =>
          row.tickSpan /
          TICK_RATE
      )
    ).median
  )} sec`
);

console.log(
  `Median attackable duration: ${formatNumber(
    payoutAttackableMedian
  )} sec`
);

console.log('');

console.log(
  'BURSTS'
);

console.log(
  '------'
);


for (
  const burst
  of urnBursts
) {

  console.log(

    `${
      burst.burstId
    } time=${
      String(
        burst.firstClock
      ).padStart(
        6
      )
    } n=${
      String(
        burst.orbCount
      ).padStart(
        2
      )
    } span=${
      (
        burst.tickSpan /
        TICK_RATE
      ).toFixed(
        2
      )
    }s radius=${
      formatNumber(
        burst.maxRadius
      ).padStart(
        7
      )
    } team=${
      String(
        burst.dominantTeam
      ).padStart(
        2
      )
    } structural=${
      burst.structuralSignaturePass
        ? 'YES'
        : 'NO '
    } idol=${
      burst
        .urnCorrelation
        ?.strong
        ? 'STRONG'
        : (
          burst
            .urnCorrelation
            ?.best
            ? 'WEAK'
            : 'NONE'
        )
    }`
  );
}


console.log('');

console.log(
  'VALIDATION'
);

console.log(
  '----------'
);


for (
  const [
    key,
    row
  ]
  of Object.entries(
    validation
  )
) {

  console.log(
    `${
      row.pass
        ? 'PASS'
        : 'FAIL'
    }  ${
      key.padEnd(
        40
      )
    } actual=${
      JSON.stringify(
        row.actual
      )
    } expected=${
      JSON.stringify(
        row.expected
      )
    }`
  );
}


console.log('');

console.log(
  `OVERALL: ${
    validationPass
      ? 'PASS'
      : 'FAIL'
  }`
);

console.log(
  `Interpretation: ${interpretation}`
);

console.log('');

console.log(
  `Summary:\n${summaryPath}`
);

console.log('');

console.log(
  `Bursts:\n${burstPath}`
);

console.log('');


// ============================================================
// NORMALIZE SCRIPT 59 EPISODE
// ============================================================

function normalizeEpisodeRow(
  row
) {

  const e =
    row?.episode;


  if (
    !e
  ) {

    return null;
  }


  const startTick =
    finite(
      e.startTick
    );


  const startPosition =
    normalizePosition(
      e.startPosition
    );


  if (
    startTick ===
      null
    ||
    !startPosition
  ) {

    return null;
  }


  return {

    episodeIndex:
      finite(
        e.episodeIndex
      ),

    episodeId:
      e.episodeId
      ??
      null,

    entityIndex:
      finite(
        e.entityIndex
      ),

    sequence:
      finite(
        e.sequence
      ),

    subclassId:
      String(
        e.subclassId
        ??
        'UNKNOWN'
      ),

    team:
      finite(
        e.team
      ),

    startTick,

    startTimeSeconds:
      finite(
        e.startTimeSeconds
      )
      ??
      tickToMatchTime(
        startTick
      ),

    startClock:
      e.startClock
      ??
      formatClock(
        tickToMatchTime(
          startTick
        )
      ),

    startPosition,

    launchNum:
      finite(
        e.launchNum
      ),

    timeLaunch:
      finite(
        e.timeLaunch
      ),

    attackableTime:
      finite(
        e.attackableTime
      ),

    endAttackableTime:
      finite(
        e.endAttackableTime
      ),

    launchToAttackableSeconds:
      finite(
        e.launchToAttackableSeconds
      ),

    attackableDurationSeconds:
      finite(
        e.attackableDurationSeconds
      ),

    launchToEndAttackableSeconds:
      finite(
        e.launchToEndAttackableSeconds
      ),

    source:
      row?.source
      ??
      null
  };
}


// ============================================================
// BUILD SEQUENTIAL BURSTS
// ============================================================

function buildSequentialBursts(
  rows
) {

  const sorted =
    [
      ...rows
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.startTick -
          b.startTick
      );


  const bursts =
    [];


  let current =
    [];


  for (
    const row
    of sorted
  ) {

    if (
      current.length ===
      0
    ) {

      current.push(
        row
      );


      continue;
    }


    const previous =
      current[
        current.length -
        1
      ];


    const centroid =
      getCentroid(
        current.map(
          item =>
            item.startPosition
        )
      );


    const tickGap =
      row.startTick -
      previous.startTick;


    const spatialGap =
      centroid
        ? getDistance3D(
          row.startPosition,
          centroid
        )
        : Infinity;


    const sameTeam =
      current.every(
        item =>
          item.team ===
          row.team
      );


    if (
      tickGap <=
        BURST_MAX_SEQUENTIAL_GAP_TICKS
      &&
      spatialGap <=
        BURST_MAX_CENTROID_DISTANCE
      &&
      sameTeam
    ) {

      current.push(
        row
      );

    } else {

      bursts.push(
        current
      );


      current =
        [
          row
        ];
    }
  }


  if (
    current.length >
    0
  ) {

    bursts.push(
      current
    );
  }


  return bursts;
}


// ============================================================
// BURST SUMMARY
// ============================================================

function summarizeBurst(
  rows,
  index
) {

  const sorted =
    [
      ...rows
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.startTick -
          b.startTick
      );


  const first =
    sorted[
      0
    ];


  const last =
    sorted[
      sorted.length -
      1
    ];


  const centroid =
    getCentroid(
      sorted.map(
        row =>
          row.startPosition
      )
    );


  const radii =
    centroid

      ? sorted.map(
        row =>
          getDistance3D(
            row.startPosition,
            centroid
          )
      )

      : [];


  const attackableDurations =
    sorted
      .map(
        row =>
          row.attackableDurationSeconds
      )
      .filter(
        Number.isFinite
      );


  const launchDelays =
    sorted
      .map(
        row =>
          row.launchToAttackableSeconds
      )
      .filter(
        Number.isFinite
      );


  const teamCounts =
    countBy(
      sorted,
      row =>
        String(
          row.team
          ??
          'UNKNOWN'
        )
    );


  const orbCount =
    sorted.length;


  const tickSpan =
    last.startTick -
    first.startTick;


  const maxRadius =
    radii.length

      ? Math.max(
        ...radii
      )

      : null;


  const attackableDurationMedian =
    summarizeNumbers(
      attackableDurations
    ).median;


  const launchDelayMedian =
    summarizeNumbers(
      launchDelays
    ).median;


  const structuralSignaturePass =
    orbCount >=
      BURST_MIN_ORBS
    &&
    orbCount <=
      BURST_MAX_ORBS
    &&
    tickSpan <=
      BURST_MAX_SPAN_TICKS
    &&
    Number.isFinite(
      maxRadius
    )
    &&
    maxRadius <=
      BURST_MAX_RADIUS
    &&
    Number.isFinite(
      attackableDurationMedian
    )
    &&
    attackableDurationMedian >=
      EXPECTED_ATTACKABLE_MIN
    &&
    attackableDurationMedian <=
      EXPECTED_ATTACKABLE_MAX;


  return {

    burstId:
      `URN_XP_${
        String(
          index +
          1
        ).padStart(
          3,
          '0'
        )
      }`,

    subclassId:
      URN_ORB_SUBCLASS,

    episodeIndexes:
      sorted.map(
        row =>
          row.episodeIndex
      ),

    episodeIds:
      sorted.map(
        row =>
          row.episodeId
      ),

    orbCount,

    firstTick:
      first.startTick,

    lastTick:
      last.startTick,

    tickSpan,

    firstTimeSeconds:
      first.startTimeSeconds,

    lastTimeSeconds:
      last.startTimeSeconds,

    firstClock:
      first.startClock,

    lastClock:
      last.startClock,

    dominantTeam:
      getDominantKey(
        teamCounts
      ),

    teamCounts:
      mapToSortedObject(
        teamCounts
      ),

    centroid,

    maxRadius,

    medianRadius:
      summarizeNumbers(
        radii
      ).median,

    launchDelayMedian,

    attackableDurationMedian,

    launchToEndMedian:
      summarizeNumbers(
        sorted.map(
          row =>
            row.launchToEndAttackableSeconds
        )
      ).median,

    structuralSignaturePass,

    urnCorrelation:
      null
  };
}


// ============================================================
// URN EVENT CORRELATION
// ============================================================

function correlateUrnEvents(
  burst,
  events
) {

  if (
    !burst.centroid
  ) {

    return {

      best:
        null,

      strong:
        false,

      candidates:
        []
    };
  }


  const candidates =
    [];


  for (
    const event
    of events
  ) {

    const tickDelta =
      event.tick -
      burst.firstTick;


    if (
      Math.abs(
        tickDelta
      ) >
      URN_EVENT_WINDOW_TICKS
    ) {

      continue;
    }


    const distance3D =
      event.position

        ? getDistance3D(
          burst.centroid,
          event.position
        )

        : null;


    if (
      Number.isFinite(
        distance3D
      )
      &&
      distance3D >
      URN_EVENT_MAX_DISTANCE
    ) {

      continue;
    }


    const operationPenalty =

      [
        'DELETE',
        'LEAVE'
      ].includes(
        event.operation
      )

        ? 0

        : (
          event.ownerChanged
          ||
          event.teamChanged
          ||
          event.deliveryLikeFieldChange
        )

          ? 250

          : (
            event.operation ===
            'CREATE'

              ? 500

              : 1000
          );


    const score =
      Math.abs(
        tickDelta
      )
      /
      TICK_RATE
      *
      1000
      +
      (
        Number.isFinite(
          distance3D
        )
          ? distance3D
          : 1500
      )
      +
      operationPenalty;


    candidates.push({

      ...event,

      tickDelta,

      secondsDelta:
        tickDelta /
        TICK_RATE,

      distance3D,

      score
    });
  }


  candidates.sort(
    (
      a,
      b
    ) =>
      a.score -
      b.score
  );


  const best =
    candidates[
      0
    ]
    ??
    null;


  const strong =
    Boolean(

      best

      &&
      Math.abs(
        best.tickDelta
      ) <=
      STRONG_URN_EVENT_TIME_TICKS

      &&
      (
        !Number.isFinite(
          best.distance3D
        )
        ||
        best.distance3D <=
        STRONG_URN_EVENT_DISTANCE
      )

      &&
      (
        [
          'DELETE',
          'LEAVE'
        ].includes(
          best.operation
        )
        ||
        best.ownerChanged
        ||
        best.teamChanged
        ||
        best.deliveryLikeFieldChange
      )
    );


  return {

    best,

    strong,

    candidates:
      candidates.slice(
        0,
        10
      )
  };
}


// ============================================================
// SITE GROUPS
// ============================================================

function buildSiteGroups(
  bursts
) {

  const groups =
    new Map();


  for (
    const burst
    of bursts
  ) {

    if (
      !burst.centroid
    ) {

      continue;
    }


    const key =
      burst.centroid.x <
        0
        ? 'NEGATIVE_X_SITE'
        : 'POSITIVE_X_SITE';


    if (
      !groups.has(
        key
      )
    ) {

      groups.set(
        key,
        []
      );
    }


    groups
      .get(
        key
      )
      .push(
        burst.centroid
      );
  }


  return Object.fromEntries(

    [
      ...groups.entries()
    ]
      .map(
        (
          [
            key,
            positions
          ]
        ) => [

          key,

          {

            burstCount:
              positions.length,

            centroid:
              getCentroid(
                positions
              ),

            x:
              summarizeNumbers(
                positions.map(
                  p =>
                    p.x
                )
              ),

            y:
              summarizeNumbers(
                positions.map(
                  p =>
                    p.y
                )
              ),

            z:
              summarizeNumbers(
                positions.map(
                  p =>
                    p.z
                )
              )
          }
        ]
      )
  );
}


// ============================================================
// TIMING FINGERPRINT
// ============================================================

function summarizeTiming(
  rows
) {

  return {

    episodeCount:
      rows.length,

    launchToAttackableSeconds:
      summarizeNumbers(
        rows.map(
          row =>
            row.launchToAttackableSeconds
        )
      ),

    attackableDurationSeconds:
      summarizeNumbers(
        rows.map(
          row =>
            row.attackableDurationSeconds
        )
      ),

    launchToEndAttackableSeconds:
      summarizeNumbers(
        rows.map(
          row =>
            row.launchToEndAttackableSeconds
        )
      )
  };
}


// ============================================================
// RANGE CHECK
// ============================================================

function tickInsideAnyRange(
  tick,
  ranges
) {

  return ranges.some(
    range =>
      tick >=
        range.min
      &&
      tick <=
        range.max
  );
}


// ============================================================
// ENTITY CHANGE HELPERS
// ============================================================

function safeGetChanges(
  event
) {

  try {

    return typeof event.getChanges ===
      'function'

      ? event.getChanges()

      : null;

  } catch {

    return null;
  }
}


function extractChangedFields(
  raw
) {

  if (
    raw ==
    null
  ) {

    return [];
  }


  if (
    raw instanceof Map
  ) {

    return [
      ...raw.keys()
    ]
      .map(
        String
      );
  }


  if (
    Array.isArray(
      raw
    )
  ) {

    return [

      ...new Set(

        raw

          .map(
            row =>

              Array.isArray(
                row
              )

                ? row[
                  0
                ]

                : (
                  row?.fieldName
                  ??
                  row?.name
                  ??
                  row?.key
                  ??
                  row?.path
                )
          )

          .filter(
            Boolean
          )

          .map(
            String
          )
      )
    ];
  }


  return typeof raw ===
    'object'

    ? Object.keys(
      raw
    )

    : [];
}


// ============================================================
// ENTITY FIELD ACCESS
// ============================================================

function safeGetField(
  entity,
  fieldName
) {

  try {

    return typeof entity.getField ===
      'function'

      ? entity.getField(
        fieldName
      )

      : undefined;

  } catch {

    return undefined;
  }
}


function getEntityClassName(
  entity
) {

  try {

    if (
      typeof entity.getClassName ===
      'function'
    ) {

      const value =
        entity.getClassName();


      if (
        value
      ) {

        return String(
          value
        );
      }
    }

  } catch {}


  return (
    entity.className
    ??
    entity
      ?.class
      ?.name
    ??
    entity
      ?._className
    ??
    null
  );
}


function getEntityIndex(
  entity
) {

  const direct =
    finite(
      entity?.index
      ??
      entity?.entityIndex
    );


  if (
    direct !==
    null
  ) {

    return direct;
  }


  try {

    return typeof entity.getIndex ===
      'function'

      ? finite(
        entity.getIndex()
      )

      : null;

  } catch {

    return null;
  }
}


function decodeOperation(
  operation
) {

  const text =
    String(
      operation
        ?._code
      ??
      operation
        ?.code
      ??
      operation
      ??
      'UNKNOWN'
    )
      .toUpperCase();


  for (
    const name
    of [
      'CREATE',
      'UPDATE',
      'LEAVE',
      'DELETE'
    ]
  ) {

    if (
      text.includes(
        name
      )
    ) {

      return name;
    }
  }


  return text;
}


// ============================================================
// POSITION
// ============================================================

function getBestPosition(
  entity
) {

  const cell =
    getCellWorldPosition(
      entity
    );


  if (
    cell
  ) {

    return cell;
  }


  for (
    const fieldName
    of [
      'CGameSceneNode.m_vecOrigin',
      'CBodyComponent.m_vecAbsOrigin',
      'm_vecAbsOrigin',
      'm_vecOrigin'
    ]
  ) {

    const value =
      normalizeVector(
        safeGetField(
          entity,
          fieldName
        )
      );


    if (
      value
    ) {

      return value;
    }
  }


  return null;
}


function getCellWorldPosition(
  entity
) {

  const cellX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellX'
      )
    );


  const cellY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellY'
      )
    );


  const cellZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellZ'
      )
    );


  const vecX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecX'
      )
    );


  const vecY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecY'
      )
    );


  const vecZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecZ'
      )
    );


  if (
    cellX ===
      null
    ||
    cellY ===
      null
    ||
    vecX ===
      null
    ||
    vecY ===
      null
  ) {

    return null;
  }


  return {

    x:
      cellX *
      512
      -
      16384
      +
      vecX,

    y:
      cellY *
      512
      -
      16384
      +
      vecY,

    z:
      cellZ !==
        null
      &&
      vecZ !==
        null

        ? (
          cellZ *
          512
          -
          16384
          +
          vecZ
        )

        : 0
  };
}


function normalizeVector(
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
    &&
    value.length >=
    2
  ) {

    return normalizePosition({

      x:
        value[
          0
        ],

      y:
        value[
          1
        ],

      z:
        value[
          2
        ]
        ??
        0
    });
  }


  if (
    typeof value ===
    'object'
  ) {

    return normalizePosition({

      x:
        value.x
        ??
        value.X
        ??
        value[
          0
        ],

      y:
        value.y
        ??
        value.Y
        ??
        value[
          1
        ],

      z:
        value.z
        ??
        value.Z
        ??
        value[
          2
        ]
        ??
        0
    });
  }


  return null;
}


function normalizePosition(
  value
) {

  if (
    !value
    ||
    typeof value !==
    'object'
  ) {

    return null;
  }


  const x =
    finite(
      value.x
    );


  const y =
    finite(
      value.y
    );


  const z =
    finite(
      value.z
    )
    ??
    0;


  return x ===
    null
    ||
    y ===
    null

    ? null

    : {
      x,
      y,
      z
    };
}


function getDistance3D(
  a,
  b
) {

  return Math.hypot(

    a.x -
    b.x,

    a.y -
    b.y,

    (
      a.z
      ??
      0
    )
    -
    (
      b.z
      ??
      0
    )
  );
}


function getCentroid(
  positions
) {

  if (
    positions.length ===
    0
  ) {

    return null;
  }


  return {

    x:
      average(
        positions.map(
          p =>
            p.x
        )
      ),

    y:
      average(
        positions.map(
          p =>
            p.y
        )
      ),

    z:
      average(
        positions.map(
          p =>
            p.z
        )
      )
  };
}


// ============================================================
// FILE
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
// COUNTERS
// ============================================================

function countBy(
  rows,
  keyFn
) {

  const map =
    new Map();


  for (
    const row
    of rows
  ) {

    const key =
      keyFn(
        row
      );


    map.set(
      key,
      (
        map.get(
          key
        )
        ??
        0
      )
      +
      1
    );
  }


  return map;
}


function mapToSortedObject(
  map
) {

  return Object.fromEntries(

    [
      ...map.entries()
    ]
      .sort(
        (
          a,
          b
        ) =>
          b[
            1
          ]
          -
          a[
            1
          ]
      )
  );
}


function getDominantKey(
  map
) {

  return map.size

    ? [
      ...map.entries()
    ]
      .sort(
        (
          a,
          b
        ) =>
          b[
            1
          ]
          -
          a[
            1
          ]
      )[
        0
      ][
        0
      ]

    : null;
}


// ============================================================
// NUMBER SUMMARY
// ============================================================

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
      clean[
        0
      ],

    p10:
      percentile(
        clean,
        0.10
      ),

    p25:
      percentile(
        clean,
        0.25
      ),

    median:
      percentile(
        clean,
        0.50
      ),

    p75:
      percentile(
        clean,
        0.75
      ),

    p90:
      percentile(
        clean,
        0.90
      ),

    max:
      clean[
        clean.length -
        1
      ],

    mean:
      clean.reduce(
        (
          sum,
          value
        ) =>
          sum +
          value,
        0
      )
      /
      clean.length
  };
}


function percentile(
  sorted,
  proportion
) {

  if (
    sorted.length ===
    1
  ) {

    return sorted[
      0
    ];
  }


  const position =
    (
      sorted.length -
      1
    )
    *
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
// GENERIC VALUES
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


function serializeScalar(
  value
) {

  if (
    value ===
      null
    ||
    value ===
      undefined
  ) {

    return null;
  }


  if (
    typeof value ===
    'bigint'
  ) {

    return value.toString();
  }


  if (
    [
      'string',
      'number',
      'boolean'
    ].includes(
      typeof value
    )
  ) {

    return value;
  }


  return String(
    value
  );
}


function average(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  return clean.length

    ? clean.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    )
    /
    clean.length

    : null;
}


// ============================================================
// TIME
// ============================================================

function tickToMatchTime(
  tick
) {

  return tick /
    TICK_RATE
    -
    MATCH_CLOCK_OFFSET_SECONDS;
}


function formatClock(
  seconds
) {

  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return null;
  }


  const negative =
    seconds <
    0;


  const absolute =
    Math.abs(
      seconds
    );


  const minutes =
    Math.floor(
      absolute /
      60
    );


  const secs =
    Math.floor(
      absolute %
      60
    );


  return `${
    negative
      ? '-'
      : ''
  }${
    minutes
  }:${
    String(
      secs
    ).padStart(
      2,
      '0'
    )
  }`;
}


// ============================================================
// VALIDATION HELPERS
// ============================================================

function check(
  actual,
  expected,
  pass
) {

  return {
    actual,
    expected,
    pass
  };
}


function formatNumber(
  value
) {

  return Number.isFinite(
    value
  )

    ? value.toFixed(
      3
    )

    : 'n/a';
}


// ============================================================
// WRITER
// ============================================================

function finishWriter(
  writer
) {

  return new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {

      writer.on(
        'error',
        rejectPromise
      );


      writer.end(
        resolvePromise
      );
    }
  );
}