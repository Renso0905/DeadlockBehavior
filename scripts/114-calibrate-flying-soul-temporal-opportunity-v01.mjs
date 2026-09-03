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
  'FLYING_SOUL_TEMPORAL_OPPORTUNITY_CALIBRATION_V01';


// ============================================================
// PURPOSE
//
// Script113 established:
//
//   STIMULUS EXISTS
//        ↓
//   PLAYER ROLE
//        ↓
//   PLAYER OBSERVED ALIVE
//
// Before adding spatial/visual accessibility, we need the exact
// temporal structure of the flying-soul stimulus.
//
// Important user-supplied behavioral consideration:
//
//   The securing side receives a short priority/grace advantage
//   before an enemy deny can prevail.
//
// Current external documentation describes this advantage as
// roughly 80 ms.
//
// IMPORTANT:
//
// Script114 does NOT assume that:
//
//   "enemy cannot shoot for exactly 80 ms"
//
// That could be implemented as:
//
//   - exclusive eligibility,
//   - winner arbitration,
//   - latency compensation,
//   - or some combination.
//
// Therefore we separate:
//
//   OBSERVED REPLAY TIMING
//
// from:
//
//   DOCUMENTED PRIORITY PRIOR.
//
// Script114:
//
//   1. Reconstructs CItemXP launch -> attackable-start timing.
//   2. Reconstructs attackable-start -> attackable-end timing.
//   3. Maps already-extracted CItemXP player damage to the
//      corresponding source-linked Trooper flying soul.
//   4. Classifies successful hit relation:
//
//        opposing orb team -> SECURE_HIT
//        same orb team     -> DENY_HIT
//
//   5. Measures successful secure/deny hit arrival relative to
//      attackability start.
//   6. Describes mixed-team races.
//   7. Reports the documented ~80 ms priority interval as a
//      PRIOR only.
//
// It does NOT yet infer:
//
//   - visibility
//   - line of sight
//   - player reaction time
//   - bullet launch time
//   - projectile travel time
//   - weapon readiness
//   - optimal play
//
// No raw .dem parsing.
//
// ============================================================


// ============================================================
// TIMING CONSTANTS
// ============================================================

const TICK_RATE =
  64;


// ------------------------------------------------------------
// Current documented prior:
//
//   ~80 ms secure-side confirmation advantage.
//
// At 64 ticks/sec:
//
//   5 ticks = 78.125 ms
//   6 ticks = 93.750 ms
//
// We report BOTH.
//
// We do not fit the exact priority buffer from this dataset.
// ------------------------------------------------------------

const DOCUMENTED_PRIORITY_MS =
  80;


const PRIORITY_DIAGNOSTIC_TICKS =
  [
    5,
    6
  ];


// ------------------------------------------------------------
// Damage-event association tolerance.
//
// Some compact extraction event ordering may be displaced by a
// few ticks around lifecycle boundaries.
//
// This is association tolerance, NOT a gameplay mechanic.
// ------------------------------------------------------------

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
    'flying_soul_temporal_opportunity_calibration_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_temporal_opportunity_calibration_v01.md'
  );


// ============================================================
// REQUIRED INPUTS
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
  'FLYING-SOUL TEMPORAL OPPORTUNITY CALIBRATION V0.1'
);

console.log(
  '========================================================'
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
  'Documented secure-priority prior: ~80 ms'
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
// CROSS-REPLAY VALIDATION
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
// CROSS-REPLAY DISTRIBUTIONS
// ============================================================

const distributions =
  {

    launchToAttackableSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions
              .launchToAttackableSeconds
        )
      ),


    attackableDurationSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions
              .attackableDurationSeconds
        )
      ),


    attackableEndToLifecycleEndSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions
              .attackableEndToLifecycleEndSeconds
        )
      ),


    secureHitSecondsAfterAttackable:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions
              .secureHitSecondsAfterAttackable
        )
      ),


    denyHitSecondsAfterAttackable:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions
              .denyHitSecondsAfterAttackable
        )
      ),


    mixedRaceHitSpanSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row.rawDistributions
              .mixedRaceHitSpanSeconds
        )
      )
  };


// ============================================================
// DOCUMENTED PRIORITY DIAGNOSTIC
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
              row.priorityDiagnostics[
                String(
                  ticks
                )
              ].secureHits
          )
        ),

      denyHits:
        sum(
          replayResults.map(
            row =>
              row.priorityDiagnostics[
                String(
                  ticks
                )
              ].denyHits
          )
        ),

      secureEpisodes:
        sum(
          replayResults.map(
            row =>
              row.priorityDiagnostics[
                String(
                  ticks
                )
              ].secureEpisodes
          )
        ),

      denyEpisodes:
        sum(
          replayResults.map(
            row =>
              row.priorityDiagnostics[
                String(
                  ticks
                )
              ].denyEpisodes
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
          'The securing side has an approximately 80 ms confirmation advantage. Script114 does not assume whether this is implemented as exclusive deny lockout or server-side race adjudication.'
      },


    behavioralImplication:
      'Secure and deny opportunities cannot share one universal onset time. A future opportunity model must preserve the securing-side priority advantage and compare weapon-adjusted earliest effective hit time against the relevant temporal deadline.',


    weaponSpecificImplication:
      'Two players with identical position and aim can have different mechanical opportunity strength because projectile velocity, shot availability, firing delay, ammo/reload state, spread, and other weapon properties affect earliest possible orb impact.',


    futureMetrics:
      {

        securePriorityMargin:
          'priority deadline minus earliest mechanically achievable secure impact',

        contestMargin:
          'weapon-adjusted secure-versus-deny effective hit timing',

        avoidableDeny:
          'A deny following a sufficiently strong prior secure opportunity; this must not be inferred until accessibility and weapon timing are modeled.'
      },


    nextStage:
      status.startsWith(
        'FLYING_SOUL_TEMPORAL_SUBSTRATE_READY'
      )
        ? 'MOVING_ORB_TRAJECTORY_PLUS_PLAYER_GEOMETRY_PLUS_WEAPON_ADJUSTED_ACTIONABILITY'
        : 'TEMPORAL_DIAGNOSIS'
  };


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
          'successful damage-arrival timing, not trigger-pull timing',

        priorityAnalysis:
          'descriptive hit arrivals inside 5- and 6-tick post-attackable-start intervals; no winner rule is fit'
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
  `Launch -> attackable:       ${formatDistribution(
    distributions.launchToAttackableSeconds
  )}`
);


console.log(
  `Attackable duration:        ${formatDistribution(
    distributions.attackableDurationSeconds
  )}`
);


console.log(
  `Attackable end -> lifecycle:${formatDistribution(
    distributions.attackableEndToLifecycleEndSeconds
  )}`
);


console.log(
  `Secure hit after start:     ${formatDistribution(
    distributions.secureHitSecondsAfterAttackable
  )}`
);


console.log(
  `Deny hit after start:       ${formatDistribution(
    distributions.denyHitSecondsAfterAttackable
  )}`
);


console.log(
  `Mixed-race hit span:        ${formatDistribution(
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
    `secureHits=${row.secureHits} denyHits=${row.denyHits} ` +
    `secureEpisodes=${row.secureEpisodes} denyEpisodes=${row.denyEpisodes}`
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
      'flying_soul_temporal_events_v01.jsonl'
    );


  const hitOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_hits_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_opportunity_summary_v01.json'
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
  // LOAD
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
  // EPISODE MAP
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
  // BUILD TEMPORAL EVENTS
  // ----------------------------------------------------------

  const temporalEvents =
    [];


  for (
    const event
    of sourceEvents
  ) {

    const episode =
      episodeById.get(
        String(
          event.orbEpisodeId
        )
      )
      ??
      null;


    if (
      !episode
    ) {

      continue;
    }


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


    const startTick =
      finite(
        event.startTick
      );


    const lifecycleEndTick =
      finite(
        event.endTick
      );


    let attackableStartTick =
      null;


    let attackableEndTick =
      null;


    let launchToAttackableSeconds =
      null;


    let attackableDurationSeconds =
      null;


    if (
      timeLaunch !==
      null
      &&
      attackableTime !==
      null
      &&
      startTick !==
      null
    ) {

      launchToAttackableSeconds =
        attackableTime -
        timeLaunch;


      attackableStartTick =
        startTick +
        Math.round(
          launchToAttackableSeconds *
          TICK_RATE
        );
    }


    if (
      timeLaunch !==
      null
      &&
      endAttackableTime !==
      null
      &&
      startTick !==
      null
    ) {

      attackableEndTick =
        startTick +
        Math.round(
          (
            endAttackableTime -
            timeLaunch
          )
          *
          TICK_RATE
        );
    }


    if (
      attackableTime !==
      null
      &&
      endAttackableTime !==
      null
    ) {

      attackableDurationSeconds =
        endAttackableTime -
        attackableTime;
    }


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


    temporalEvents.push(
      {

        ...event,


        temporal:
          {

            timeLaunch,

            attackableTime,

            endAttackableTime,

            launchToAttackableSeconds,

            attackableDurationSeconds,

            attackableStartTick,

            attackableEndTick,

            lifecycleEndTick,

            attackableEndToLifecycleEndSeconds,


            documentedSecurePriority:
              {

                milliseconds:
                  DOCUMENTED_PRIORITY_MS,

                status:
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
  // INDEX TEMPORAL EVENTS BY ENTITY
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
  // NORMALIZE DAMAGE EVENTS
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


  // ----------------------------------------------------------
  // MATCH DAMAGE TO SOURCE-LINKED ORB EPISODE
  // ----------------------------------------------------------

  for (
    const damage
    of normalizedDamage
  ) {

    const candidates =
      eventsByEntity.get(
        damage.victimEntityIndex
      )
      ??
      [];


    if (
      candidates.length ===
      0
    ) {

      continue;
    }


    const matching =
      candidates
        .filter(
          event => {

            const minTick =
              event.startTick -
              HIT_ASSOCIATION_BEFORE_TICKS;


            const maxTick =
              event.endTick +
              HIT_ASSOCIATION_AFTER_TICKS;


            return (
              damage.tick >=
              minTick
              &&
              damage.tick <=
              maxTick
            );
          }
        )
        .sort(
          (
            a,
            b
          ) =>
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
      matching.length ===
      0
    ) {

      continue;
    }


    const event =
      matching[0];


    matchedDamageEvents++;


    const attackerTeam =
      finite(
        damage.attackerTeam
      );


    let relation =
      'RELATION_UNRESOLVED';


    if (
      isGameTeam(
        attackerTeam
      )
      &&
      isGameTeam(
        event.orbTeam
      )
    ) {

      relation =
        attackerTeam ===
          event.orbTeam
          ? 'DENY_HIT'
          : 'SECURE_HIT';
    }


    if (
      damage.attackerPlayerName
    ) {

      playerAttributedHits++;
    }


    const attackableStartTick =
      event
        .temporal
        .attackableStartTick;


    const attackableEndTick =
      event
        .temporal
        .attackableEndTick;


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

        attackerTeam,

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

        insideAttackableWindow:

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
            attackableEndTick,

        rawDamage:
          damage.raw
      }
    );
  }


  // ----------------------------------------------------------
  // FINALIZE EVENT HIT/RACE SUMMARIES
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


    const firstSecure =
      secureHits[0]
      ??
      null;


    const firstDeny =
      denyHits[0]
      ??
      null;


    const mixedRace =
      Boolean(
        firstSecure
        &&
        firstDeny
      );


    const firstRoleHit =
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


    event.hitSummary =
      {

        totalHits:
          event.hits.length,

        secureHits:
          secureHits.length,

        denyHits:
          denyHits.length,

        unresolvedHits:
          event.hits.length -
          secureHits.length -
          denyHits.length,

        firstSecure,

        firstDeny,

        firstRoleHit,

        mixedRace,


        mixedRaceTickDifference:

          mixedRace
            ? firstDeny.tick -
              firstSecure.tick
            : null,


        mixedRaceAbsoluteSpanTicks:

          mixedRace
            ? Math.abs(
                firstDeny.tick -
                firstSecure.tick
              )
            : null,


        mixedRaceAbsoluteSpanSeconds:

          mixedRace
            ? Math.abs(
                firstDeny.tick -
                firstSecure.tick
              )
              /
              TICK_RATE
            : null
      };


    for (
      const hit
      of event.hits
    ) {

      hitRows.push(
        {

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
  // VALID TIMING EVENTS
  // ----------------------------------------------------------

  const timingValid =
    temporalEvents.filter(
      row =>
        Number.isFinite(
          row
            .temporal
            .launchToAttackableSeconds
        )
        &&
        Number.isFinite(
          row
            .temporal
            .attackableDurationSeconds
        )
        &&
        Number.isFinite(
          row
            .temporal
            .attackableStartTick
        )
        &&
        Number.isFinite(
          row
            .temporal
            .attackableEndTick
        )
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


  const exactWindowHits =
    hitRows.filter(
      row =>
        row.insideAttackableWindow
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
  // DOCUMENTED PRIORITY DIAGNOSTICS
  // ----------------------------------------------------------

  const priorityDiagnostics =
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

        interpretation:
          'DESCRIPTIVE_SUCCESSFUL_HIT_ARRIVAL_ONLY'
      };
  }


  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const timingCoverageRate =
    rate(
      timingValid.length,
      temporalEvents.length
    );


  const timingReady =
    temporalEvents.length >
      0
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
      0;


  // ----------------------------------------------------------
  // RAW DISTRIBUTIONS
  // ----------------------------------------------------------

  const launchToAttackableSeconds =
    timingValid.map(
      row =>
        row
          .temporal
          .launchToAttackableSeconds
    );


  const attackableDurationSeconds =
    timingValid.map(
      row =>
        row
          .temporal
          .attackableDurationSeconds
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
            .mixedRaceAbsoluteSpanSeconds
      )
      .filter(
        Number.isFinite
      );


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

          exactAttackableWindowHits:
            exactWindowHits.length,

          exactAttackableWindowRate:
            rate(
              exactWindowHits.length,
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
            hitRows.length -
            secureHits.length -
            denyHits.length,


          secureAfterAttackableStart:
            summarizeNumbers(
              secureHits.map(
                row =>
                  row
                    .ticksAfterAttackableStart
              )
            ),

          denyAfterAttackableStart:
            summarizeNumbers(
              denyHits.map(
                row =>
                  row
                    .ticksAfterAttackableStart
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
                    .mixedRaceAbsoluteSpanTicks
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
                    .mixedRaceTickDifference
              )
            ),

          caution:
            'Presence/order of successful damage messages alone does not establish server winner adjudication in a mixed-team race.'
        },


      priorityDiagnostics,


      validation:
        {

          timingReady,

          hitTelemetryReady,

          checks:
            {

              sourceEventsPresent:
                temporalEvents.length >
                0,

              timingCoverageAtLeast95Percent:
                timingCoverageRate >=
                0.95,

              compactDamageObserved:
                normalizedDamage.length >
                0,

              sourceLinkedDamageObserved:
                matchedDamageEvents >
                0,

              playerAttributedHitObserved:
                playerAttributedHits >
                0
            }
        },


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
  // WRITE
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
// NORMALIZE COMPACT DAMAGE
//
// Script102 compact formats are intentionally tolerated here.
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

        row.damageTick
      ]
    );


  if (
    tick ===
    null
  ) {

    return null;
  }


  const victimEntityIndex =
    normalizeEntityReference(
      firstDefined(
        [

          row.victimEntityIndex,

          row.victimIndex,

          row.entityIndex,

          row.targetEntityIndex,

          row.victim,

          row.victimRaw
        ]
      )
    );


  if (
    victimEntityIndex ===
    null
  ) {

    return null;
  }


  const attackerEntityIndex =
    normalizeEntityReference(
      firstDefined(
        [

          row.attackerEntityIndex,

          row.attackerIndex,

          row.attackerPawnEntityIndex,

          row.attacker,

          row.attackerRaw
        ]
      )
    );


  const embeddedPlayer =
    row.attackerPlayer
    ??
    row.player
    ??
    null;


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
    embeddedPlayer?.playerName
    ??
    embeddedPlayer?.name
    ??
    row.attackerPlayerName
    ??
    row.playerName
    ??
    mappedPlayer?.playerName
    ??
    null;


  const attackerTeam =
    firstFinite(
      [

        embeddedPlayer?.team,

        row.attackerTeam,

        row.playerTeam,

        mappedPlayer?.team
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

    tick,

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
      row
        ?.controller
        ?.playerName
      ??
      null;


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
// ENTITY REFERENCE
// ============================================================

const ENTITY_INDEX_MASK =
  0x3fff;


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


  const stream =
    await import(
      'node:fs'
    );


  const writer =
    stream.createWriteStream(
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
      row.timing.launchToAttackableSeconds.median
    )} sec`
  );


  console.log(
    `  attackable duration:        ${formatNumber(
      row.timing.attackableDurationSeconds.median
    )} sec`
  );


  console.log(
    `  attackable end -> lifecycle:${formatNumber(
      row.timing.attackableEndToLifecycleEndSeconds.median
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
    `  matched source-linked hits: ${row.damageTelemetry.matchedSourceLinkedOrbDamage}`
  );


  console.log(
    `  player-attributed:          ${row.damageTelemetry.playerAttributedHits}`
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
    `  secure median after start:  ${formatNumber(
      row.successfulHits.secureSecondsAfterAttackableStart.median
    )} sec`
  );


  console.log(
    `  deny median after start:    ${formatNumber(
      row.successfulHits.denySecondsAfterAttackableStart.median
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

    const p =
      row.priorityDiagnostics[
        String(
          ticks
        )
      ];


    console.log(
      `  <=${ticks} ticks: secure=${p.secureHits} deny=${p.denyHits}`
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
    '# Flying-Soul Temporal Opportunity Calibration'
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
    '## Important distinction'
  );


  lines.push(
    ''
  );


  lines.push(
    'The securing side has a documented approximately 80 ms confirmation advantage, but this script does not assume that the implementation is a literal exclusive deny lockout. It preserves that value as an external mechanic prior.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Replay timing'
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
      `- Timing coverage: ${formatPercent(replay.events.timingCoverageRate)}`
    );


    lines.push(
      `- Launch -> attackable median: ${formatNumber(replay.timing.launchToAttackableSeconds.median)} sec`
    );


    lines.push(
      `- Attackable duration median: ${formatNumber(replay.timing.attackableDurationSeconds.median)} sec`
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
      ''
    );
  }


  lines.push(
    '## Behavioral consequence'
  );


  lines.push(
    ''
  );


  lines.push(
    'Future opportunity classification must use role-specific temporal semantics. A player who is alive and geometrically near an orb is not necessarily equally able to secure or deny it at every instant.'
  );


  lines.push(
    ''
  );


  lines.push(
    'The eventual actionability model should compare weapon-adjusted earliest possible impact time against the secure-priority and contest deadlines.'
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}