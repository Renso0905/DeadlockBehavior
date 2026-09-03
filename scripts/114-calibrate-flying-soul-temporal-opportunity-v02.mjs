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


// ============================================================
// VERSION
// ============================================================

const VERSION =
  'FLYING_SOUL_TEMPORAL_OPPORTUNITY_CALIBRATION_V02';


// ============================================================
// SCRIPT114 V01 CORRECTION
//
// V01 failed before completing rep01 because:
//
//   normalizeEntityReference()
//
// referenced:
//
//   ENTITY_INDEX_MASK
//
// before execution had reached that const declaration.
//
// Function declarations are callable before their textual
// position, but const declarations are not initialized until
// execution reaches them.
//
// V02 moves ALL runtime constants above the top-level execution
// path.
//
// This is a CODE-ONLY correction.
//
// No mechanic interpretation changed.
// No prior replay extraction must be rerun.
// ============================================================


// ============================================================
// GLOBAL CONSTANTS
// ============================================================

const TICK_RATE =
  64;


// Source 2 entity handles contain serial/index information.
//
// We use the low entity-index bits when a raw reference is larger
// than a direct entity index.
const ENTITY_INDEX_MASK =
  0x3fff;


// ============================================================
// SECURE-PRIORITY PRIOR
//
// Current working external prior:
//
//   securing side has approximately 80 ms of adjudication
//   advantage.
//
// At 64 ticks/sec:
//
//   5 ticks = 78.125 ms
//   6 ticks = 93.750 ms
//
// We report both 5 and 6 ticks.
//
// IMPORTANT:
//
// We do NOT infer from this script that the enemy is physically
// incapable of firing during those ticks.
//
// The implementation could involve:
//
//   - exclusive eligibility,
//   - server-side winner arbitration,
//   - latency compensation,
//   - or some combination.
//
// ============================================================

const DOCUMENTED_PRIORITY_MS =
  80;


const PRIORITY_DIAGNOSTIC_TICKS =
  [
    5,
    6
  ];


// ============================================================
// DAMAGE -> ORB EPISODE ASSOCIATION
//
// Association tolerance only.
//
// NOT a game-mechanic timing constant.
// ============================================================

const HIT_ASSOCIATION_BEFORE_TICKS =
  4;


const HIT_ASSOCIATION_AFTER_TICKS =
  8;


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT113_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_opportunity_existence_batch_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_temporal_opportunity_calibration_v02.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_temporal_opportunity_calibration_v02.md'
  );


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT113_PATH
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


const script113 =
  JSON.parse(
    readFileSync(
      SCRIPT113_PATH,
      'utf8'
    )
  );


if (
  script113?.status !==
  'FLYING_SOUL_OPPORTUNITY_EXISTENCE_BASE_READY'
) {

  throw new Error(
    `Script113 base not ready.\nStatus: ${script113?.status}`
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
    'No independent replication cohort.'
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
  'FLYING-SOUL TEMPORAL OPPORTUNITY CALIBRATION V0.2'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'V01 CORRECTION'
);

console.log(
  '--------------'
);


console.log(
  'ENTITY_INDEX_MASK initialization-order failure corrected.'
);


console.log(
  'No prior telemetry or analytical result is invalidated.'
);


console.log('');

console.log(
  'TEMPORAL MODEL'
);

console.log(
  '--------------'
);


console.log(
  'launch -> attackable start -> attackable end -> resolution'
);


console.log('');

console.log(
  `Documented secure-priority prior: ~${DOCUMENTED_PRIORITY_MS} ms`
);


console.log(
  'Operational diagnostics:          5 ticks / 6 ticks'
);


console.log('');

console.log(
  `Independent replay units:         ${cohort.length}`
);


console.log(
  'Raw .dem parsing:                  NONE'
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
      cohort[index].replayName
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


  printReplayResult(
    result
  );


  console.log('');
}


// ============================================================
// CROSS-REPLAY READINESS
// ============================================================

const timingReadyReplays =
  replayResults.filter(
    row =>
      row.validation.timingReady
  );


const hitReadyReplays =
  replayResults.filter(
    row =>
      row.validation.hitTelemetryReady
  );


let status;


if (
  timingReadyReplays.length ===
  replayResults.length
) {

  status =
    hitReadyReplays.length >=
      3
      ? 'FLYING_SOUL_TEMPORAL_SUBSTRATE_READY_SHOT_TIMING_AVAILABLE'
      : 'FLYING_SOUL_TEMPORAL_SUBSTRATE_READY_SHOT_RACES_SPARSE';

} else {

  status =
    'FLYING_SOUL_TEMPORAL_SUBSTRATE_REQUIRES_DIAGNOSIS';
}


// ============================================================
// GLOBAL DISTRIBUTIONS
// ============================================================

const distributions =
  {

    launchToAttackableSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .launchToAttackableSeconds
        )
      ),


    attackableDurationSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .attackableDurationSeconds
        )
      ),


    attackableEndToLifecycleEndSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .attackableEndToLifecycleEndSeconds
        )
      ),


    secureHitSecondsAfterAttackable:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .secureHitSecondsAfterAttackable
        )
      ),


    denyHitSecondsAfterAttackable:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .denyHitSecondsAfterAttackable
        )
      ),


    mixedRaceHitSpanSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .mixedRaceHitSpanSeconds
        )
      )
  };


// ============================================================
// GLOBAL PRIORITY DIAGNOSTICS
// ============================================================

const priorityDiagnostics =
  {};


for (
  const ticks
  of PRIORITY_DIAGNOSTIC_TICKS
) {

  priorityDiagnostics[
    String(
      ticks
    )
  ] =
    {

      ticks,

      milliseconds:
        ticks /
        TICK_RATE *
        1000,

      secureHits:
        sum(
          replayResults.map(
            row =>
              row
                .priorityDiagnostics[
                  String(
                    ticks
                  )
                ]
                .secureHits
          )
        ),

      denyHits:
        sum(
          replayResults.map(
            row =>
              row
                .priorityDiagnostics[
                  String(
                    ticks
                  )
                ]
                .denyHits
          )
        ),

      secureEpisodes:
        sum(
          replayResults.map(
            row =>
              row
                .priorityDiagnostics[
                  String(
                    ticks
                  )
                ]
                .secureEpisodes
          )
        ),

      denyEpisodes:
        sum(
          replayResults.map(
            row =>
              row
                .priorityDiagnostics[
                  String(
                    ticks
                  )
                ]
                .denyEpisodes
          )
        )
    };
}


// ============================================================
// INTERPRETATION
// ============================================================

const interpretation =
  {

    temporalSubstrateReady:
      timingReadyReplays.length ===
      replayResults.length,


    documentedMechanicPrior:
      {

        value:
          DOCUMENTED_PRIORITY_MS,

        unit:
          'milliseconds',

        semanticStatus:
          'DOCUMENTED_PRIOR_NOT_REPLAY_CANONICALIZED',

        interpretation:
          'The securing side has an approximately 80 ms confirmation advantage. This script does not assume whether that is implemented as an exclusive deny lockout or server-side race adjudication.'
      },


    behavioralImplication:
      'Secure and deny opportunity timing must remain role-specific. Stimulus existence and player survival are insufficient to establish an actionable opportunity.',


    weaponSpecificImplication:
      'Two players in equivalent geometry may have different opportunity strength because firing state, projectile velocity, projectile travel time, reload state, rate-of-fire lockout, spread, and other hero/weapon characteristics affect earliest achievable orb impact.',


    futureMetrics:
      {

        earliestEffectiveHitTime:
          'Earliest mechanically possible projectile/orb impact for a particular player given state and weapon.',

        securePriorityMargin:
          'Secure-priority deadline minus earliest mechanically possible secure impact.',

        contestMargin:
          'Relative weapon-adjusted effective-impact timing for securing and denying sides.',

        avoidableDeny:
          'A later deny following a sufficiently strong prior secure opportunity. Not yet classified in this script.'
      },


    nextStage:
      status.startsWith(
        'FLYING_SOUL_TEMPORAL_SUBSTRATE_READY'
      )
        ? 'MOVING_ORB_TRAJECTORY_PLUS_PLAYER_GEOMETRY_PLUS_WEAPON_ADJUSTED_ACTIONABILITY'
        : 'TEMPORAL_DIAGNOSIS'
  };


// ============================================================
// GLOBAL SUMMARY
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


    correction:
      {

        supersedes:
          'FLYING_SOUL_TEMPORAL_OPPORTUNITY_CALIBRATION_V01',

        reason:
          'V01 JavaScript temporal-dead-zone failure for ENTITY_INDEX_MASK.',

        analyticalImpact:
          'NONE',

        replayReparseRequired:
          false
      },


    priorLayer:
      script113.status,


    documentedPriorityPrior:
      {

        milliseconds:
          DOCUMENTED_PRIORITY_MS,

        approximateTicks:
          DOCUMENTED_PRIORITY_MS /
          1000 *
          TICK_RATE,

        diagnosticTicks:
          PRIORITY_DIAGNOSTIC_TICKS,

        status:
          'EXTERNAL_DOCUMENTED_PRIOR',

        caution:
          'Do not interpret this value as an exact exclusive enemy lockout unless replay evidence establishes that implementation.'
      },


    methodology:
      {

        replicationUnit:
          'REPLAY',

        rawReplayParsing:
          false,

        timingFields:
          [

            'm_timeLaunch',

            'm_flAttackableTime',

            'm_flEndAttackableTime'
          ],

        attackableStart:
          'startTick + round((m_flAttackableTime - m_timeLaunch) * 64)',

        attackableEnd:
          'startTick + round((m_flEndAttackableTime - m_timeLaunch) * 64)',

        secureHit:
          'player-attributed CItemXP damage from a player whose team opposes orbTeam',

        denyHit:
          'player-attributed CItemXP damage from a player whose team equals orbTeam',

        hitTiming:
          'successful damage-arrival timing rather than trigger-pull timing',

        priorityAnalysis:
          'descriptive successful-hit arrival inside 5- and 6-tick post-attackable-start intervals; no arbitration rule is fit'
      },


    replayCounts:
      {

        total:
          replayResults.length,

        timingReady:
          timingReadyReplays.length,

        hitTelemetryReady:
          hitReadyReplays.length
      },


    distributions,

    priorityDiagnostics,

    replays:
      replayResults,

    interpretation,


    outputs:
      {

        json:
          OUTPUT_JSON_PATH,

        markdown:
          OUTPUT_MARKDOWN_PATH
      }
  };


// ============================================================
// WRITE GLOBAL OUTPUTS
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
  'TEMPORAL OPPORTUNITY CROSS-REPLAY SUMMARY'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'TIMING DISTRIBUTIONS'
);

console.log(
  '--------------------'
);


console.log(
  `Launch -> attackable:        ${formatDistribution(
    distributions.launchToAttackableSeconds
  )}`
);


console.log(
  `Attackable duration:         ${formatDistribution(
    distributions.attackableDurationSeconds
  )}`
);


console.log(
  `Attackable end -> lifecycle: ${formatDistribution(
    distributions.attackableEndToLifecycleEndSeconds
  )}`
);


console.log(
  `Secure hit after start:      ${formatDistribution(
    distributions.secureHitSecondsAfterAttackable
  )}`
);


console.log(
  `Deny hit after start:        ${formatDistribution(
    distributions.denyHitSecondsAfterAttackable
  )}`
);


console.log(
  `Mixed-race hit span:         ${formatDistribution(
    distributions.mixedRaceHitSpanSeconds
  )}`
);


console.log('');

console.log(
  'DOCUMENTED PRIORITY-INTERVAL DIAGNOSTIC'
);

console.log(
  '---------------------------------------'
);


for (
  const ticks
  of PRIORITY_DIAGNOSTIC_TICKS
) {

  const row =
    priorityDiagnostics[
      String(
        ticks
      )
    ];


  console.log(
    `${ticks} ticks (${row.milliseconds.toFixed(3)} ms): ` +
    `secureHits=${row.secureHits} ` +
    `denyHits=${row.denyHits} ` +
    `secureEpisodes=${row.secureEpisodes} ` +
    `denyEpisodes=${row.denyEpisodes}`
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
  interpretation.nextStage
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
// ANALYZE ONE REPLAY
// ============================================================

async function analyzeReplay(
  replayName
) {

  const outputDirectory =
    resolve(
      'output',
      replayName
    );


  const eventsPath =
    resolve(
      outputDirectory,
      'flying_soul_opportunity_events_v01.jsonl'
    );


  const episodesPath =
    resolve(
      outputDirectory,
      'replication_citemxp_source_episodes_v01.jsonl'
    );


  const damagePath =
    resolve(
      outputDirectory,
      'replication_citemxp_damage_events_v01.jsonl'
    );


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const eventOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_events_v02.jsonl'
    );


  const hitOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_hits_v02.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_opportunity_summary_v02.json'
    );


  for (
    const path
    of [
      eventsPath,
      episodesPath,
      damagePath,
      playerStatePath
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


  // ----------------------------------------------------------
  // LOAD EXISTING TELEMETRY
  // ----------------------------------------------------------

  const sourceEvents =
    await loadJsonl(
      eventsPath
    );


  const episodes =
    await loadJsonl(
      episodesPath
    );


  const rawDamage =
    await loadJsonl(
      damagePath
    );


  const playerByPawnIndex =
    await loadPlayerPawnMap(
      playerStatePath
    );


  // ----------------------------------------------------------
  // EPISODE INDEX
  // ----------------------------------------------------------

  const episodeById =
    new Map();


  for (
    const episode
    of episodes
  ) {

    episodeById.set(
      String(
        episode.episodeId
      ),
      episode
    );
  }


  // ----------------------------------------------------------
  // BUILD TEMPORAL EVENT RECORDS
  // ----------------------------------------------------------

  const temporalEvents =
    [];


  for (
    const sourceEvent
    of sourceEvents
  ) {

    const episode =
      episodeById.get(
        String(
          sourceEvent.orbEpisodeId
        )
      )
      ??
      null;


    if (
      !episode
    ) {

      continue;
    }


    const startTick =
      finite(
        sourceEvent.startTick
      );


    const lifecycleEndTick =
      finite(
        sourceEvent.endTick
      );


    const timeLaunch =
      finite(
        episode.timeLaunch
      );


    const attackableTime =
      finite(
        episode.attackableTime
      );


    const endAttackableTime =
      finite(
        episode.endAttackableTime
      );


    const launchToAttackableSeconds =

      timeLaunch !==
        null
      &&
      attackableTime !==
        null

        ? attackableTime -
          timeLaunch

        : null;


    const launchToAttackableEndSeconds =

      timeLaunch !==
        null
      &&
      endAttackableTime !==
        null

        ? endAttackableTime -
          timeLaunch

        : null;


    const attackableDurationSeconds =

      attackableTime !==
        null
      &&
      endAttackableTime !==
        null

        ? endAttackableTime -
          attackableTime

        : null;


    const attackableStartTick =

      startTick !==
        null
      &&
      launchToAttackableSeconds !==
        null

        ? startTick +
          Math.round(
            launchToAttackableSeconds *
            TICK_RATE
          )

        : null;


    const attackableEndTick =

      startTick !==
        null
      &&
      launchToAttackableEndSeconds !==
        null

        ? startTick +
          Math.round(
            launchToAttackableEndSeconds *
            TICK_RATE
          )

        : null;


    const attackableEndToLifecycleEndSeconds =

      attackableEndTick !==
        null
      &&
      lifecycleEndTick !==
        null

        ? (
            lifecycleEndTick -
            attackableEndTick
          )
          /
          TICK_RATE

        : null;


    const timingValid =

      startTick !==
        null
      &&
      lifecycleEndTick !==
        null
      &&
      launchToAttackableSeconds !==
        null
      &&
      attackableDurationSeconds !==
        null
      &&
      attackableStartTick !==
        null
      &&
      attackableEndTick !==
        null
      &&
      attackableEndTick >=
        attackableStartTick;


    temporalEvents.push(
      {

        ...sourceEvent,


        temporal:
          {

            timeLaunch,

            attackableTime,

            endAttackableTime,

            launchToAttackableSeconds,

            launchToAttackableEndSeconds,

            attackableDurationSeconds,

            attackableStartTick,

            attackableEndTick,

            lifecycleEndTick,

            attackableEndToLifecycleEndSeconds,

            timingValid,


            documentedSecurePriority:
              {

                milliseconds:
                  DOCUMENTED_PRIORITY_MS,

                semanticStatus:
                  'DOCUMENTED_PRIOR',

                fiveTickEnd:
                  attackableStartTick ===
                    null
                    ? null
                    : attackableStartTick +
                      5,

                sixTickEnd:
                  attackableStartTick ===
                    null
                    ? null
                    : attackableStartTick +
                      6
              }
          },


        hits:
          []
      }
    );
  }


  // ----------------------------------------------------------
  // INDEX SOURCE-LINKED ORBS BY ENTITY
  // ----------------------------------------------------------

  const eventsByEntity =
    groupBy(
      temporalEvents,
      row =>
        finite(
          row.orbEntityIndex
        )
    );


  for (
    const rows
    of eventsByEntity.values()
  ) {

    rows.sort(
      (
        a,
        b
      ) =>
        a.startTick -
        b.startTick
    );
  }


  // ----------------------------------------------------------
  // NORMALIZE COMPACT CITEMXP DAMAGE EVENTS
  // ----------------------------------------------------------

  const normalizedDamage =
    rawDamage
      .map(
        row =>
          normalizeDamageEvent(
            row,
            playerByPawnIndex
          )
      )
      .filter(
        Boolean
      );


  let matchedDamageEvents =
    0;


  let playerAttributedHits =
    0;


  let relationResolvedHits =
    0;


  // ----------------------------------------------------------
  // MATCH DAMAGE EVENTS TO SOURCE-LINKED LOGICAL ORBS
  // ----------------------------------------------------------

  for (
    const damage
    of normalizedDamage
  ) {

    const candidateEvents =
      eventsByEntity.get(
        damage.victimEntityIndex
      )
      ??
      [];


    if (
      candidateEvents.length ===
      0
    ) {

      continue;
    }


    const matches =
      candidateEvents
        .filter(
          event => {

            const minimumTick =
              event.startTick -
              HIT_ASSOCIATION_BEFORE_TICKS;


            const maximumTick =
              event.endTick +
              HIT_ASSOCIATION_AFTER_TICKS;


            return (
              damage.tick >=
              minimumTick
              &&
              damage.tick <=
              maximumTick
            );
          }
        )
        .sort(
          (
            a,
            b
          ) =>
            intervalDistance(
              damage.tick,
              a.startTick,
              a.endTick
            )
            -
            intervalDistance(
              damage.tick,
              b.startTick,
              b.endTick
            )
            ||
            Math.abs(
              damage.tick -
              a.startTick
            )
            -
            Math.abs(
              damage.tick -
              b.startTick
            )
        );


    if (
      matches.length ===
      0
    ) {

      continue;
    }


    const event =
      matches[0];


    matchedDamageEvents++;


    let relation =
      'RELATION_UNRESOLVED';


    if (
      isGameTeam(
        damage.attackerTeam
      )
      &&
      isGameTeam(
        event.orbTeam
      )
    ) {

      relation =
        damage.attackerTeam ===
          event.orbTeam
          ? 'DENY_HIT'
          : 'SECURE_HIT';


      relationResolvedHits++;
    }


    if (
      damage.attackerPlayerName
    ) {

      playerAttributedHits++;
    }


    const attackableStartTick =
      finite(
        event
          ?.temporal
          ?.attackableStartTick
      );


    const attackableEndTick =
      finite(
        event
          ?.temporal
          ?.attackableEndTick
      );


    const ticksAfterAttackableStart =

      attackableStartTick ===
        null

        ? null

        : damage.tick -
          attackableStartTick;


    const ticksBeforeAttackableEnd =

      attackableEndTick ===
        null

        ? null

        : attackableEndTick -
          damage.tick;


    const insideAttackableWindow =

      attackableStartTick !==
        null
      &&
      attackableEndTick !==
        null
      &&
      damage.tick >=
        attackableStartTick
      &&
      damage.tick <=
        attackableEndTick;


    event.hits.push(
      {

        tick:
          damage.tick,

        victimEntityIndex:
          damage.victimEntityIndex,

        attackerEntityIndex:
          damage.attackerEntityIndex,

        attackerPlayerName:
          damage.attackerPlayerName,

        attackerTeam:
          damage.attackerTeam,

        attackerHeroId:
          damage.attackerHeroId,

        relation,

        ticksAfterLaunch:
          damage.tick -
          event.startTick,

        ticksAfterAttackableStart,

        secondsAfterAttackableStart:

          Number.isFinite(
            ticksAfterAttackableStart
          )

            ? ticksAfterAttackableStart /
              TICK_RATE

            : null,

        ticksBeforeAttackableEnd,

        insideAttackableWindow,

        rawDamage:
          damage.raw
      }
    );
  }


  // ----------------------------------------------------------
  // EVENT HIT SUMMARIES
  // ----------------------------------------------------------

  const hitRows =
    [];


  for (
    const event
    of temporalEvents
  ) {

    event.hits.sort(
      (
        a,
        b
      ) =>
        a.tick -
        b.tick
    );


    const secureHits =
      event.hits.filter(
        row =>
          row.relation ===
          'SECURE_HIT'
      );


    const denyHits =
      event.hits.filter(
        row =>
          row.relation ===
          'DENY_HIT'
      );


    const unresolvedHits =
      event.hits.filter(
        row =>
          row.relation ===
          'RELATION_UNRESOLVED'
      );


    const firstSecure =
      secureHits[0]
      ??
      null;


    const firstDeny =
      denyHits[0]
      ??
      null;


    const firstResolvedRoleHit =
      [
        firstSecure,
        firstDeny
      ]
        .filter(
          Boolean
        )
        .sort(
          (
            a,
            b
          ) =>
            a.tick -
            b.tick
        )[0]
      ??
      null;


    const mixedRace =
      Boolean(
        firstSecure
        &&
        firstDeny
      );


    const raceSignedDenyMinusSecureTicks =

      mixedRace
        ? firstDeny.tick -
          firstSecure.tick
        : null;


    const raceAbsoluteSpanTicks =

      mixedRace
        ? Math.abs(
            raceSignedDenyMinusSecureTicks
          )
        : null;


    event.hitSummary =
      {

        totalHits:
          event.hits.length,

        secureHits:
          secureHits.length,

        denyHits:
          denyHits.length,

        unresolvedHits:
          unresolvedHits.length,

        firstSecure,

        firstDeny,

        firstResolvedRoleHit,

        mixedRace,

        raceSignedDenyMinusSecureTicks,

        raceAbsoluteSpanTicks,

        raceAbsoluteSpanSeconds:

          Number.isFinite(
            raceAbsoluteSpanTicks
          )

            ? raceAbsoluteSpanTicks /
              TICK_RATE

            : null
      };


    for (
      const hit
      of event.hits
    ) {

      hitRows.push(
        {

          schemaVersion:
            2,

          canonical:
            false,

          replay:
            replayName,

          eventId:
            event.eventId,

          orbEpisodeId:
            event.orbEpisodeId,

          orbEntityIndex:
            event.orbEntityIndex,

          orbTeam:
            event.orbTeam,

          sourceDeathId:
            event.sourceDeathId,

          sourceDeathTick:
            event.sourceDeathTick,

          attackableStartTick:
            event
              .temporal
              .attackableStartTick,

          attackableEndTick:
            event
              .temporal
              .attackableEndTick,

          ...hit
        }
      );
    }
  }


  // ----------------------------------------------------------
  // TEMPORAL VALIDITY
  // ----------------------------------------------------------

  const timingValid =
    temporalEvents.filter(
      row =>
        row
          ?.temporal
          ?.timingValid ===
        true
    );


  const timingCoverageRate =
    rate(
      timingValid.length,
      temporalEvents.length
    );


  // ----------------------------------------------------------
  // HIT CLASSES
  // ----------------------------------------------------------

  const secureHits =
    hitRows.filter(
      row =>
        row.relation ===
        'SECURE_HIT'
    );


  const denyHits =
    hitRows.filter(
      row =>
        row.relation ===
        'DENY_HIT'
    );


  const unresolvedHits =
    hitRows.filter(
      row =>
        row.relation ===
        'RELATION_UNRESOLVED'
    );


  const attackableWindowHits =
    hitRows.filter(
      row =>
        row.insideAttackableWindow ===
        true
    );


  const mixedRaces =
    temporalEvents.filter(
      row =>
        row
          ?.hitSummary
          ?.mixedRace ===
        true
    );


  // ----------------------------------------------------------
  // PRIORITY DIAGNOSTICS
  // ----------------------------------------------------------

  const replayPriorityDiagnostics =
    {};


  for (
    const ticks
    of PRIORITY_DIAGNOSTIC_TICKS
  ) {

    const secureInside =
      secureHits.filter(
        row =>
          Number.isFinite(
            row.ticksAfterAttackableStart
          )
          &&
          row.ticksAfterAttackableStart >=
            0
          &&
          row.ticksAfterAttackableStart <=
            ticks
      );


    const denyInside =
      denyHits.filter(
        row =>
          Number.isFinite(
            row.ticksAfterAttackableStart
          )
          &&
          row.ticksAfterAttackableStart >=
            0
          &&
          row.ticksAfterAttackableStart <=
            ticks
      );


    replayPriorityDiagnostics[
      String(
        ticks
      )
    ] =
      {

        ticks,

        milliseconds:
          ticks /
          TICK_RATE *
          1000,

        secureHits:
          secureInside.length,

        denyHits:
          denyInside.length,

        secureEpisodes:
          new Set(
            secureInside.map(
              row =>
                row.eventId
            )
          ).size,

        denyEpisodes:
          new Set(
            denyInside.map(
              row =>
                row.eventId
            )
          ).size,

        semanticStatus:
          'DESCRIPTIVE_SUCCESSFUL_HIT_ARRIVAL_ONLY',

        caution:
          'A deny-side damage event inside this interval does not by itself prove that the deny was legally capable of defeating an earlier secure-side claim.'
      };
  }


  // ----------------------------------------------------------
  // RAW DISTRIBUTIONS
  // ----------------------------------------------------------

  const launchToAttackableSeconds =
    timingValid
      .map(
        row =>
          row
            .temporal
            .launchToAttackableSeconds
      )
      .filter(
        Number.isFinite
      );


  const attackableDurationSeconds =
    timingValid
      .map(
        row =>
          row
            .temporal
            .attackableDurationSeconds
      )
      .filter(
        Number.isFinite
      );


  const attackableEndToLifecycleEndSeconds =
    timingValid
      .map(
        row =>
          row
            .temporal
            .attackableEndToLifecycleEndSeconds
      )
      .filter(
        Number.isFinite
      );


  const secureHitSecondsAfterAttackable =
    secureHits
      .map(
        row =>
          row.secondsAfterAttackableStart
      )
      .filter(
        Number.isFinite
      );


  const denyHitSecondsAfterAttackable =
    denyHits
      .map(
        row =>
          row.secondsAfterAttackableStart
      )
      .filter(
        Number.isFinite
      );


  const mixedRaceHitSpanSeconds =
    mixedRaces
      .map(
        row =>
          row
            .hitSummary
            .raceAbsoluteSpanSeconds
      )
      .filter(
        Number.isFinite
      );


  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const timingReady =
    temporalEvents.length >
      0
    &&
    timingCoverageRate !==
      null
    &&
    timingCoverageRate >=
      0.95;


  const hitTelemetryReady =
    normalizedDamage.length >
      0
    &&
    matchedDamageEvents >
      0
    &&
    playerAttributedHits >
      0
    &&
    relationResolvedHits >
      0;


  const validation =
    {

      timingReady,

      hitTelemetryReady,


      checks:
        {

          sourceEventsPresent:
            temporalEvents.length >
            0,

          timingCoverageAtLeast95Percent:
            timingCoverageRate !==
              null
            &&
            timingCoverageRate >=
              0.95,

          compactDamageRowsPresent:
            rawDamage.length >
            0,

          normalizedDamagePresent:
            normalizedDamage.length >
            0,

          sourceLinkedDamageObserved:
            matchedDamageEvents >
            0,

          playerAttributedHitObserved:
            playerAttributedHits >
            0,

          roleResolvedHitObserved:
            relationResolvedHits >
            0
        }
    };


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  const result =
    {

      replay:
        replayName,

      version:
        VERSION,

      canonical:
        false,


      events:
        {

          inputSourceLinked:
            sourceEvents.length,

          temporalReconstructed:
            temporalEvents.length,

          validTiming:
            timingValid.length,

          timingCoverageRate
        },


      timing:
        {

          launchToAttackableSeconds:
            summarizeNumbers(
              launchToAttackableSeconds
            ),

          attackableDurationSeconds:
            summarizeNumbers(
              attackableDurationSeconds
            ),

          attackableEndToLifecycleEndSeconds:
            summarizeNumbers(
              attackableEndToLifecycleEndSeconds
            )
        },


      damageTelemetry:
        {

          compactDamageRows:
            rawDamage.length,

          normalizedDamageRows:
            normalizedDamage.length,

          matchedSourceLinkedOrbDamage:
            matchedDamageEvents,

          playerAttributedHits,

          relationResolvedHits,

          exactAttackableWindowHits:
            attackableWindowHits.length,

          exactAttackableWindowRate:
            rate(
              attackableWindowHits.length,
              hitRows.length
            )
        },


      successfulHits:
        {

          total:
            hitRows.length,

          secure:
            secureHits.length,

          deny:
            denyHits.length,

          unresolved:
            unresolvedHits.length,


          secureAfterAttackableStartTicks:
            summarizeNumbers(
              secureHits.map(
                row =>
                  row.ticksAfterAttackableStart
              )
            ),

          denyAfterAttackableStartTicks:
            summarizeNumbers(
              denyHits.map(
                row =>
                  row.ticksAfterAttackableStart
              )
            ),

          secureSecondsAfterAttackableStart:
            summarizeNumbers(
              secureHitSecondsAfterAttackable
            ),

          denySecondsAfterAttackableStart:
            summarizeNumbers(
              denyHitSecondsAfterAttackable
            )
        },


      races:
        {

          mixedTeamEpisodes:
            mixedRaces.length,

          absoluteHitSpanTicks:
            summarizeNumbers(
              mixedRaces.map(
                row =>
                  row
                    .hitSummary
                    .raceAbsoluteSpanTicks
              )
            ),

          absoluteHitSpanSeconds:
            summarizeNumbers(
              mixedRaceHitSpanSeconds
            ),

          signedDenyMinusSecureTicks:
            summarizeNumbers(
              mixedRaces.map(
                row =>
                  row
                    .hitSummary
                    .raceSignedDenyMinusSecureTicks
              )
            ),

          caution:
            'Successful damage-message order does not by itself establish the server winner-adjudication rule.'
        },


      priorityDiagnostics:
        replayPriorityDiagnostics,


      validation,


      rawDistributions:
        {

          launchToAttackableSeconds,

          attackableDurationSeconds,

          attackableEndToLifecycleEndSeconds,

          secureHitSecondsAfterAttackable,

          denyHitSecondsAfterAttackable,

          mixedRaceHitSpanSeconds
        },


      outputs:
        {

          temporalEvents:
            eventOutputPath,

          temporalHits:
            hitOutputPath,

          summary:
            replaySummaryPath
        }
    };


  // ----------------------------------------------------------
  // WRITE REPLAY OUTPUTS
  // ----------------------------------------------------------

  await writeJsonl(
    eventOutputPath,
    temporalEvents
  );


  await writeJsonl(
    hitOutputPath,
    hitRows
  );


  writeFileSync(
    replaySummaryPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    'utf8'
  );


  return result;
}


// ============================================================
// DAMAGE NORMALIZATION
//
// Script102 compact CItemXP damage telemetry may use slightly
// different naming forms.
//
// V02 intentionally accepts multiple forms.
//
// ============================================================

function normalizeDamageEvent(
  row,
  playerByPawnIndex
) {

  const tick =
    firstFinite(
      [

        row.tick,

        row.demoTick,

        row.damageTick,

        row.eventTick,

        deepFindNumber(
          row,
          [
            /^tick$/i,
            /^demoTick$/i,
            /^damageTick$/i
          ]
        )
      ]
    );


  if (
    tick ===
    null
  ) {

    return null;
  }


  const victimRaw =
    firstDefined(
      [

        row.victimEntityIndex,

        row.victimIndex,

        row.targetEntityIndex,

        row.targetIndex,

        row.entityIndex,

        row.victim,

        row.victimRaw,

        deepFindValue(
          row,
          [
            /^victimEntityIndex$/i,
            /^victimIndex$/i,
            /^entindexVictim$/i,
            /^entindex_victim$/i,
            /^targetEntityIndex$/i,
            /^targetIndex$/i
          ]
        )
      ]
    );


  const victimEntityIndex =
    normalizeEntityReference(
      victimRaw
    );


  if (
    victimEntityIndex ===
    null
  ) {

    return null;
  }


  const attackerRaw =
    firstDefined(
      [

        row.attackerEntityIndex,

        row.attackerIndex,

        row.attackerPawnEntityIndex,

        row.attackerPawnIndex,

        row.attacker,

        row.attackerRaw,

        deepFindValue(
          row,
          [
            /^attackerEntityIndex$/i,
            /^attackerIndex$/i,
            /^attackerPawnEntityIndex$/i,
            /^entindexAttacker$/i,
            /^entindex_attacker$/i
          ]
        )
      ]
    );


  const attackerEntityIndex =
    normalizeEntityReference(
      attackerRaw
    );


  const embeddedPlayer =
    firstObject(
      [

        row.attackerPlayer,

        row.player,

        row.attackerIdentity
      ]
    );


  const mappedPlayer =
    attackerEntityIndex ===
      null

      ? null

      : playerByPawnIndex.get(
          attackerEntityIndex
        )
        ??
        null;


  const attackerPlayerName =
    firstString(
      [

        embeddedPlayer?.playerName,

        embeddedPlayer?.name,

        row.attackerPlayerName,

        row.playerName,

        row.attackerName,

        mappedPlayer?.playerName
      ]
    );


  const attackerTeam =
    firstFinite(
      [

        embeddedPlayer?.team,

        row.attackerTeam,

        row.playerTeam,

        mappedPlayer?.team,

        deepFindNumber(
          row,
          [
            /^attackerTeam$/i,
            /^playerTeam$/i
          ]
        )
      ]
    );


  const attackerHeroId =
    firstFinite(
      [

        embeddedPlayer?.heroId,

        row.attackerHeroId,

        row.heroId,

        mappedPlayer?.heroId
      ]
    );


  return {

    tick:

      Math.trunc(
        tick
      ),

    victimEntityIndex,

    attackerEntityIndex,

    attackerPlayerName,

    attackerTeam,

    attackerHeroId,

    raw:
      row
  };
}


// ============================================================
// PLAYER PAWN MAP
// ============================================================

async function loadPlayerPawnMap(
  path
) {

  const map =
    new Map();


  const reader =
    createInterface(
      {

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
      }
    );


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


    const pawnIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );


    const playerName =
      firstString(
        [

          row
            ?.controller
            ?.playerName,

          row.playerName
        ]
      );


    if (
      pawnIndex ===
        null
      ||
      !playerName
    ) {

      continue;
    }


    const old =
      map.get(
        pawnIndex
      )
      ??
      {};


    map.set(
      pawnIndex,
      {

        playerName,

        team:
          finite(
            row
              ?.controller
              ?.team
          )
          ??
          old.team
          ??
          null,

        heroId:
          finite(
            row
              ?.controller
              ?.heroId
          )
          ??
          old.heroId
          ??
          null,

        pawnEntityIndex:
          pawnIndex
      }
    );
  }


  return map;
}


// ============================================================
// ENTITY REFERENCE NORMALIZATION
//
// ENTITY_INDEX_MASK is initialized near the TOP of this script
// before any top-level analysis begins.
//
// ============================================================

function normalizeEntityReference(
  value
) {

  const numeric =
    scalarNumberOrNull(
      value
    );


  if (
    numeric ===
      null
    ||
    numeric <
      0
  ) {

    return null;
  }


  const integer =
    Math.trunc(
      numeric
    );


  if (
    integer <=
    ENTITY_INDEX_MASK
  ) {

    return integer;
  }


  return integer &
    ENTITY_INDEX_MASK;
}


// ============================================================
// DEEP OBJECT SEARCH
// ============================================================

function deepFindValue(
  object,
  patterns,
  depth =
    0
) {

  if (
    object ===
      null
    ||
    object ===
      undefined
    ||
    typeof object !==
      'object'
    ||
    depth >
      4
  ) {

    return null;
  }


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      object
    )
  ) {

    if (
      patterns.some(
        pattern =>
          pattern.test(
            key
          )
      )
    ) {

      return value;
    }
  }


  for (
    const value
    of Object.values(
      object
    )
  ) {

    if (
      !value
      ||
      typeof value !==
        'object'
    ) {

      continue;
    }


    const result =
      deepFindValue(
        value,
        patterns,
        depth +
          1
      );


    if (
      result !==
        null
      &&
      result !==
        undefined
    ) {

      return result;
    }
  }


  return null;
}


function deepFindNumber(
  object,
  patterns
) {

  return scalarNumberOrNull(
    deepFindValue(
      object,
      patterns
    )
  );
}


// ============================================================
// INTERVAL DISTANCE
// ============================================================

function intervalDistance(
  tick,
  startTick,
  endTick
) {

  if (
    tick <
    startTick
  ) {

    return startTick -
      tick;
  }


  if (
    tick >
    endTick
  ) {

    return tick -
      endTick;
  }


  return 0;
}


// ============================================================
// COLLECTION HELPERS
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
      key ===
        null
      ||
      key ===
        undefined
    ) {

      continue;
    }


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
// FILE HELPERS
// ============================================================

async function loadJsonl(
  path
) {

  const rows =
    [];


  const reader =
    createInterface(
      {

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
      }
    );


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

  mkdirSync(
    dirname(
      path
    ),
    {
      recursive:
        true
    }
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
      resolvePromise,
      rejectPromise
    ) => {

      writer.on(
        'error',
        rejectPromise
      );


      writer.on(
        'finish',
        resolvePromise
      );


      writer.end();
    }
  );
}


// ============================================================
// VALUE HELPERS
// ============================================================

function firstDefined(
  values
) {

  for (
    const value
    of values
  ) {

    if (
      value !==
        null
      &&
      value !==
        undefined
    ) {

      return value;
    }
  }


  return null;
}


function firstFinite(
  values
) {

  for (
    const value
    of values
  ) {

    const number =
      scalarNumberOrNull(
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


function firstObject(
  values
) {

  for (
    const value
    of values
  ) {

    if (
      value
      &&
      typeof value ===
        'object'
      &&
      !Array.isArray(
        value
      )
    ) {

      return value;
    }
  }


  return null;
}


function scalarNumberOrNull(
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


  if (
    typeof value ===
    'number'
  ) {

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  if (
    typeof value ===
    'bigint'
  ) {

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


  if (
    typeof value ===
    'string'
  ) {

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


  if (
    typeof value ===
    'object'
  ) {

    const candidate =

      value._value

      ??

      value.value

      ??

      value._code

      ??

      value.code

      ??

      value._id

      ??

      value.id

      ??

      value.index

      ??

      value.entityIndex

      ??

      value.entindex

      ??

      null;


    if (
      candidate !==
        null
      &&
      candidate !==
        undefined
    ) {

      return scalarNumberOrNull(
        candidate
      );
    }
  }


  return null;
}


function finite(
  value
) {

  return scalarNumberOrNull(
    value
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
// NUMERIC HELPERS
// ============================================================

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

  return values.reduce(
    (
      total,
      value
    ) =>
      total +
      (
        Number.isFinite(
          value
        )
          ? value
          : 0
      ),
    0
  );
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


  return sum(
    clean
  )
  /
  clean.length;
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

      p05:
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

    p05:
      quantile(
        clean,
        0.05
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

function printReplayResult(
  row
) {

  console.log('');

  console.log(
    'TEMPORAL FIELDS'
  );


  console.log(
    `  source-linked events:       ${row.events.inputSourceLinked}`
  );


  console.log(
    `  valid timing:               ${row.events.validTiming}/${row.events.temporalReconstructed} (${formatPercent(
      row.events.timingCoverageRate
    )})`
  );


  console.log(
    `  launch -> attackable:       ${formatNumber(
      row
        .timing
        .launchToAttackableSeconds
        .median
    )} sec`
  );


  console.log(
    `  attackable duration:        ${formatNumber(
      row
        .timing
        .attackableDurationSeconds
        .median
    )} sec`
  );


  console.log(
    `  attackable end -> lifecycle:${formatNumber(
      row
        .timing
        .attackableEndToLifecycleEndSeconds
        .median
    )} sec`
  );


  console.log('');

  console.log(
    'SUCCESSFUL HIT TELEMETRY'
  );


  console.log(
    `  compact damage rows:        ${row.damageTelemetry.compactDamageRows}`
  );


  console.log(
    `  normalized damage rows:     ${row.damageTelemetry.normalizedDamageRows}`
  );


  console.log(
    `  matched source-linked hits: ${row.damageTelemetry.matchedSourceLinkedOrbDamage}`
  );


  console.log(
    `  player-attributed:          ${row.damageTelemetry.playerAttributedHits}`
  );


  console.log(
    `  role-resolved:              ${row.damageTelemetry.relationResolvedHits}`
  );


  console.log(
    `  inside attackable window:   ${row.damageTelemetry.exactAttackableWindowHits}/${row.successfulHits.total} (${formatPercent(
      row.damageTelemetry.exactAttackableWindowRate
    )})`
  );


  console.log(
    `  secure hits:                ${row.successfulHits.secure}`
  );


  console.log(
    `  deny hits:                  ${row.successfulHits.deny}`
  );


  console.log(
    `  unresolved hits:            ${row.successfulHits.unresolved}`
  );


  console.log(
    `  secure median after start:  ${formatNumber(
      row
        .successfulHits
        .secureSecondsAfterAttackableStart
        .median
    )} sec`
  );


  console.log(
    `  deny median after start:    ${formatNumber(
      row
        .successfulHits
        .denySecondsAfterAttackableStart
        .median
    )} sec`
  );


  console.log(
    `  mixed-team races:           ${row.races.mixedTeamEpisodes}`
  );


  console.log('');

  console.log(
    'PRIORITY-INTERVAL DIAGNOSTIC'
  );


  for (
    const ticks
    of PRIORITY_DIAGNOSTIC_TICKS
  ) {

    const priority =
      row
        .priorityDiagnostics[
          String(
            ticks
          )
        ];


    console.log(
      `  <=${ticks} ticks (${priority.milliseconds.toFixed(3)} ms): ` +
      `secure=${priority.secureHits} ` +
      `deny=${priority.denyHits}`
    );
  }


  console.log('');

  console.log(
    `TIMING READY:                 ${row.validation.timingReady}`
  );


  console.log(
    `HIT TELEMETRY READY:          ${row.validation.hitTelemetryReady}`
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
    '# Flying-Soul Temporal Opportunity Calibration V0.2'
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
    '## V01 correction'
  );


  lines.push(
    ''
  );


  lines.push(
    'V01 failed because `ENTITY_INDEX_MASK` was referenced before its `const` declaration had executed. V02 moves the constant above the main execution path. No replay telemetry or prior analytical result was invalidated.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Temporal model'
  );


  lines.push(
    ''
  );


  lines.push(
    '`launch -> attackable start -> attackable end -> lifecycle resolution`'
  );


  lines.push(
    ''
  );


  lines.push(
    'The approximately 80 ms securing-side priority advantage remains an external documented prior rather than an exact replay-derived lockout duration.'
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
      `- Source-linked flying souls: ${replay.events.inputSourceLinked}`
    );


    lines.push(
      `- Timing coverage: ${formatPercent(replay.events.timingCoverageRate)}`
    );


    lines.push(
      `- Launch -> attackable median: ${formatNumber(replay.timing.launchToAttackableSeconds.median)} sec`
    );


    lines.push(
      `- Attackable duration median: ${formatNumber(replay.timing.attackableDurationSeconds.median)} sec`
    );


    lines.push(
      `- Matched source-linked CItemXP damage events: ${replay.damageTelemetry.matchedSourceLinkedOrbDamage}`
    );


    lines.push(
      `- Secure hits: ${replay.successfulHits.secure}`
    );


    lines.push(
      `- Deny hits: ${replay.successfulHits.deny}`
    );


    lines.push(
      `- Mixed-team races: ${replay.races.mixedTeamEpisodes}`
    );


    lines.push(
      `- Timing ready: **${replay.validation.timingReady}**`
    );


    lines.push(
      `- Hit telemetry ready: **${replay.validation.hitTelemetryReady}**`
    );


    lines.push(
      ''
    );
  }


  lines.push(
    '## Behavioral interpretation'
  );


  lines.push(
    ''
  );


  lines.push(
    'Secure and deny opportunity timing must remain role-specific. A living player near an orb is not automatically an actionable opportunity.'
  );


  lines.push(
    ''
  );


  lines.push(
    'The eventual model should compare the player/hero weapon system’s earliest mechanically achievable impact time against the securing-side priority interval and subsequent contest window.'
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}