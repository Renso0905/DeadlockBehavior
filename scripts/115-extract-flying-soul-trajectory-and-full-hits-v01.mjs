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
// VERSION
// ============================================================

const VERSION =
  'FLYING_SOUL_TRAJECTORY_AND_FULL_HITS_EXTRACTION_V01';


// ============================================================
// PURPOSE
//
// Script113 established source-linked Trooper flying-soul
// existence, player role, and alive-state overlap.
//
// Script114 V02 established the replicated temporal substrate:
//
//   launch
//      -> ~0.65 sec
//   attackable start
//      -> ~0.70 sec nominal attackable interval
//   attackable end
//
// Script114 intentionally used the compact Script102 CItemXP
// damage stream. That stream is excellent for replication checks
// but is too sparse for behavioral opportunity modeling.
//
// Script115 performs ONE targeted raw replay pass per replay and
// extracts two foundational behavioral substrates:
//
//   A. MOVING ORB TRAJECTORY
//
//      Every observed post-update CItemXP position sample belonging
//      to one of Script114's exact source-linked Trooper flying-soul
//      episodes.
//
//   B. COMPLETE DAMAGE TELEMETRY AGAINST THOSE ORBS
//
//      Every replay Damage message whose victim resolves to one of
//      those exact logical CItemXP episodes.
//
// This gives the next stage:
//
//   player position
//   + validated player eye orientation
//   + moving orb position
//   + attackable interval
//   + observed successful shots
//
// IMPORTANT:
//
// This script is EXTRACTION / VALIDATION ONLY.
//
// It does NOT yet infer:
//
//   - line of sight
//   - actual visual attention
//   - shootability for a specific hero
//   - trigger-pull time
//   - projectile launch time
//   - projectile travel time
//   - ammo / reload / rate-of-fire readiness
//   - reaction time
//   - ignored opportunity
//   - optimal play
//
// ============================================================


// ============================================================
// GLOBAL CONSTANTS
//
// Keep ALL runtime constants above top-level execution.
// This avoids the Script114 V01 temporal-dead-zone mistake.
// ============================================================

const TICK_RATE =
  64;


const ENTITY_INDEX_MASK =
  0x3fff;


// ------------------------------------------------------------
// Damage message numeric fallback.
//
// Earlier scripts successfully captured the replay's Damage
// channel. We primarily detect it by decoded message-name text
// containing DAMAGE; numeric ID is only a fallback.
// ------------------------------------------------------------

const DAMAGE_MESSAGE_ID =
  300;


// ------------------------------------------------------------
// Damage -> logical orb association envelope.
//
// This is TELEMETRY tolerance only.
// It is not a gameplay timing constant.
// ------------------------------------------------------------

const DAMAGE_MATCH_BEFORE_TICKS =
  4;


const DAMAGE_MATCH_AFTER_TICKS =
  8;


// ------------------------------------------------------------
// Position trajectory matching uses the exact logical episode
// interval. No broad gameplay tolerance is applied.
// ------------------------------------------------------------

const TRAJECTORY_MATCH_BEFORE_TICKS =
  0;


const TRAJECTORY_MATCH_AFTER_TICKS =
  0;


// ============================================================
// VALIDATION THRESHOLDS
//
// These are pipeline-readiness checks, not mechanic constants.
// ============================================================

const VALIDATION =
  {

    minimumTrajectoryEventCoverage:
      0.95,

    minimumPositionEventCoverage:
      0.95,

    minimumPlayerAttributionRate:
      0.90,

    minimumRoleResolutionRate:
      0.90,

    minimumTolerantAttackableHitRate:
      0.90
  };


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const SCRIPT114_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_temporal_opportunity_calibration_v02.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_trajectory_and_full_hits_batch_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_trajectory_and_full_hits_batch_v01.md'
  );


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    SCRIPT114_PATH
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


const script114 =
  JSON.parse(
    readFileSync(
      SCRIPT114_PATH,
      'utf8'
    )
  );


if (
  !String(
    script114?.status ??
    ''
  ).startsWith(
    'FLYING_SOUL_TEMPORAL_SUBSTRATE_READY'
  )
) {

  throw new Error(
    `Script114 temporal substrate is not ready.\nStatus: ${script114?.status}`
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
  'FLYING-SOUL TRAJECTORY + FULL HIT EXTRACTION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'PURPOSE'
);

console.log(
  '-------'
);

console.log(
  'Extract moving CItemXP trajectory and complete Damage'
);

console.log(
  'telemetry for Script114 source-linked Trooper flying souls.'
);

console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);

console.log(
  'Raw .dem parsing:          YES -- one targeted pass/replay'
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
// CROSS-REPLAY STATUS
// ============================================================

const passingReplays =
  replayResults.filter(
    row =>
      row.validation.pass
  );


const status =
  passingReplays.length ===
  replayResults.length
    ? 'FLYING_SOUL_TRAJECTORY_AND_FULL_HIT_SUBSTRATE_READY'
    : 'FLYING_SOUL_TRAJECTORY_AND_FULL_HIT_SUBSTRATE_REQUIRES_DIAGNOSIS';


// ============================================================
// CROSS-REPLAY DISTRIBUTIONS
// ============================================================

const distributions =
  {

    trajectoryEventCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .trajectory
              .eventCoverageRate
        )
      ),


    positionEventCoverage:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .trajectory
              .positionEventCoverageRate
        )
      ),


    trajectorySamplesPerEvent:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .trajectorySamplesPerEvent
        )
      ),


    positionSamplesPerEvent:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .positionSamplesPerEvent
        )
      ),


    trajectoryTickGaps:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .trajectoryTickGaps
        )
      ),


    matchedHitsPerReplay:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .damage
              .matchedHits
        )
      ),


    shotEpisodesPerReplay:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .damage
              .shotEpisodes
        )
      ),


    playerAttributionRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .damage
              .playerAttributionRate
        )
      ),


    roleResolutionRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .damage
              .roleResolutionRate
        )
      ),


    exactAttackableHitRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .damage
              .exactAttackableHitRate
        )
      ),


    tolerantAttackableHitRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .damage
              .tolerantAttackableHitRate
        )
      ),


    secureSecondsAfterAttackableStart:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .secureSecondsAfterAttackableStart
        )
      ),


    denySecondsAfterAttackableStart:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .rawDistributions
              .denySecondsAfterAttackableStart
        )
      )
  };


// ============================================================
// INTERPRETATION
// ============================================================

const interpretation =
  {

    status,


    establishedIfPass:
      [

        'Observed moving trajectory samples for source-linked Trooper flying souls.',

        'Comprehensive replay Damage-message extraction against those exact logical orb episodes.',

        'Player attribution and secure-versus-deny relation for observed successful hits.',

        'Successful hit timing relative to the replicated attackable interval.'
      ],


    stillNotEstablished:
      [

        'Line of sight.',

        'Visual attention.',

        'Hero-specific shootability.',

        'Weapon readiness.',

        'Projectile launch time.',

        'Projectile travel time for unobserved/missed response opportunities.',

        'Whether a non-response was a behavioral omission rather than mechanical impossibility.'
      ],


    nextStage:
      status ===
      'FLYING_SOUL_TRAJECTORY_AND_FULL_HIT_SUBSTRATE_READY'
        ? 'BUILD_PLAYER_ORB_GEOMETRY_AND_POSITIVE_ACTIONABILITY_ANCHORS'
        : 'EXTRACTION_DIAGNOSIS'
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


    priorTemporalLayer:
      script114.status,


    methodology:
      {

        replicationUnit:
          'REPLAY',

        rawReplayParsing:
          true,

        trajectorySource:
          'CItemXP ENTITY_PACKET post-update state matched to Script114 logical source-linked orb episode.',

        hitSource:
          'Replay Damage messages matched by victim entity index and logical episode timing.',

        roleRule:
          {

            opposingOrbTeam:
              'SECURE_HIT',

            sameOrbTeam:
              'DENY_HIT'
          },

        attackableTiming:
          'Uses Script114 reconstructed attackableStartTick and attackableEndTick.',

        semanticGuardrail:
          'Damage-message timing is observed impact/outcome timing and is not equivalent to trigger-pull time.'
      },


    validationThresholds:
      VALIDATION,


    replayCounts:
      {

        total:
          replayResults.length,

        passing:
          passingReplays.length
      },


    distributions,

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
  'CROSS-REPLAY TRAJECTORY + FULL HIT SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'REPLAY RESULTS'
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

    `traj=${formatPercent(
      row.trajectory.eventCoverageRate
    ).padEnd(8)} ` +

    `pos=${formatPercent(
      row.trajectory.positionEventCoverageRate
    ).padEnd(8)} ` +

    `hits=${String(
      row.damage.matchedHits
    ).padEnd(6)} ` +

    `shotEpisodes=${String(
      row.damage.shotEpisodes
    ).padEnd(6)} ` +

    `pass=${row.validation.pass}`
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
  `Trajectory event coverage: ${formatDistribution(
    distributions.trajectoryEventCoverage
  )}`
);


console.log(
  `Position event coverage:   ${formatDistribution(
    distributions.positionEventCoverage
  )}`
);


console.log(
  `Trajectory samples/event:  ${formatDistribution(
    distributions.trajectorySamplesPerEvent
  )}`
);


console.log(
  `Trajectory tick gaps:      ${formatDistribution(
    distributions.trajectoryTickGaps
  )}`
);


console.log(
  `Full hits/replay:          ${formatDistribution(
    distributions.matchedHitsPerReplay
  )}`
);


console.log(
  `Shot episodes/replay:      ${formatDistribution(
    distributions.shotEpisodesPerReplay
  )}`
);


console.log(
  `Player attribution:        ${formatDistribution(
    distributions.playerAttributionRate
  )}`
);


console.log(
  `Role resolution:           ${formatDistribution(
    distributions.roleResolutionRate
  )}`
);


console.log(
  `Exact attackable hit rate: ${formatDistribution(
    distributions.exactAttackableHitRate
  )}`
);


console.log(
  `Tolerant hit rate:         ${formatDistribution(
    distributions.tolerantAttackableHitRate
  )}`
);


console.log(
  `Secure hit after start:    ${formatDistribution(
    distributions.secureSecondsAfterAttackableStart
  )}`
);


console.log(
  `Deny hit after start:      ${formatDistribution(
    distributions.denySecondsAfterAttackableStart
  )}`
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


  const replayPath =
    resolve(
      'replays',
      `${replayName}.dem`
    );


  const temporalEventsPath =
    resolve(
      outputDirectory,
      'flying_soul_temporal_events_v02.jsonl'
    );


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const trajectoryOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_trajectory_v01.jsonl'
    );


  const hitsOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_full_damage_hits_v01.jsonl'
    );


  const eventCoverageOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_trajectory_event_coverage_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_trajectory_and_full_hits_summary_v01.json'
    );


  for (
    const path
    of [
      replayPath,
      temporalEventsPath,
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
  // LOAD SOURCE-LINKED TEMPORAL EVENTS
  // ----------------------------------------------------------

  const temporalEvents =
    await loadJsonl(
      temporalEventsPath
    );


  if (
    temporalEvents.length ===
    0
  ) {

    throw new Error(
      `${replayName}: no Script114 temporal events.`
    );
  }


  // ----------------------------------------------------------
  // SCRIPT114 COMPACT-HIT REFERENCE
  // ----------------------------------------------------------

  const script114Replay =
    Array.isArray(
      script114.replays
    )
      ? script114.replays.find(
          row =>
            row.replay ===
            replayName
        )
        ??
        null
      : null;


  const compactMatchedHits =
    finite(
      script114Replay
        ?.damageTelemetry
        ?.matchedSourceLinkedOrbDamage
    )
    ??
    0;


  // ----------------------------------------------------------
  // PLAYER PAWN IDENTITIES
  // ----------------------------------------------------------

  const playerByPawnIndex =
    await loadPlayerPawnMap(
      playerStatePath
    );


  // ----------------------------------------------------------
  // INDEX TEMPORAL EVENTS BY ENTITY INDEX
  // ----------------------------------------------------------

  const eventsByEntity =
    new Map();


  for (
    const event
    of temporalEvents
  ) {

    const entityIndex =
      finite(
        event.orbEntityIndex
      );


    if (
      entityIndex ===
      null
    ) {

      continue;
    }


    if (
      !eventsByEntity.has(
        entityIndex
      )
    ) {

      eventsByEntity.set(
        entityIndex,
        []
      );
    }


    eventsByEntity
      .get(
        entityIndex
      )
      .push(
        event
      );
  }


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


  const targetEntityIndexes =
    new Set(
      eventsByEntity.keys()
    );


  // ----------------------------------------------------------
  // EXTRACTION STORAGE
  // ----------------------------------------------------------

  const trajectoryByEventTick =
    new Map();


  const damageHits =
    [];


  let entityPacketMutations =
    0;


  let citemxpMutations =
    0;


  let targetCItemXPMutations =
    0;


  let targetTrajectoryMatches =
    0;


  let targetTrajectoryAmbiguous =
    0;


  let trajectoryPositionSamples =
    0;


  let messagePackets =
    0;


  let damageLikeMessages =
    0;


  let damageMessagesWithVictim =
    0;


  let targetVictimDamageMessages =
    0;


  let matchedDamageMessages =
    0;


  let ambiguousDamageMatches =
    0;


  let playerAttributedHits =
    0;


  let roleResolvedHits =
    0;


  const damageMessageFieldNames =
    new Set();


  const damageMessageTypeCounts =
    new Map();


  // ----------------------------------------------------------
  // PARSER
  // ----------------------------------------------------------

  const parser =
    new Parser();


  // ==========================================================
  // ENTITY TRAJECTORY
  // ==========================================================

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
      ) {

        return;
      }


      for (
        const entityEvent
        of events ??
        []
      ) {

        entityPacketMutations++;


        const entity =
          entityEvent?.entity;


        if (
          !entity
        ) {

          continue;
        }


        const className =
          getEntityClassName(
            entity
          );


        if (
          className !==
          'CItemXP'
        ) {

          continue;
        }


        citemxpMutations++;


        const entityIndex =
          getEntityIndex(
            entity
          );


        if (
          entityIndex ===
          null
          ||
          !targetEntityIndexes.has(
            entityIndex
          )
        ) {

          continue;
        }


        targetCItemXPMutations++;


        const matches =
          matchEventsAtTick({

            rows:
              eventsByEntity.get(
                entityIndex
              )
              ??
              [],

            tick,

            beforeTicks:
              TRAJECTORY_MATCH_BEFORE_TICKS,

            afterTicks:
              TRAJECTORY_MATCH_AFTER_TICKS
          });


        if (
          matches.length ===
          0
        ) {

          continue;
        }


        if (
          matches.length >
          1
        ) {

          targetTrajectoryAmbiguous++;
        }


        const event =
          chooseBestEvent(
            matches,
            tick
          );


        if (
          !event
        ) {

          continue;
        }


        targetTrajectoryMatches++;


        const position =
          getBestPosition(
            entity
          );


        if (
          position
        ) {

          trajectoryPositionSamples++;
        }


        const sample =
          {

            schemaVersion:
              1,

            canonical:
              false,

            replay:
              replayName,

            eventId:
              event.eventId,

            orbEpisodeId:
              event.orbEpisodeId,

            orbEntityIndex:
              entityIndex,

            orbTeam:
              finite(
                event.orbTeam
              ),

            sourceDeathId:
              event.sourceDeathId,

            sourceDeathTick:
              finite(
                event.sourceDeathTick
              ),

            tick,

            secondsAfterLaunch:
              Number.isFinite(
                finite(
                  event.startTick
                )
              )
                ? (
                    tick -
                    Number(
                      event.startTick
                    )
                  )
                  /
                  TICK_RATE
                : null,

            secondsAfterAttackableStart:
              Number.isFinite(
                finite(
                  event
                    ?.temporal
                    ?.attackableStartTick
                )
              )
                ? (
                    tick -
                    Number(
                      event
                        .temporal
                        .attackableStartTick
                    )
                  )
                  /
                  TICK_RATE
                : null,

            operation:
              decodeOperation(
                entityEvent.operation
              ),

            changedFields:
              extractChangedFields(
                safeGetChanges(
                  entityEvent
                )
              ),

            position,

            team:
              finite(
                safeGetField(
                  entity,
                  'm_iTeamNum'
                )
              ),

            subclassId:
              scalarStringOrNull(
                safeGetField(
                  entity,
                  'm_nSubclassID'
                )
              ),

            simulationTime:
              finite(
                safeGetField(
                  entity,
                  'm_flSimulationTime'
                )
              ),

            timeLaunch:
              finite(
                safeGetField(
                  entity,
                  'm_timeLaunch'
                )
              ),

            attackableTime:
              finite(
                safeGetField(
                  entity,
                  'm_flAttackableTime'
                )
              ),

            endAttackableTime:
              finite(
                safeGetField(
                  entity,
                  'm_flEndAttackableTime'
                )
              )
          };


        // One consolidated post-update sample per logical
        // event/tick. If multiple mutations occur on the same
        // tick, the final post-interceptor state is retained.
        trajectoryByEventTick.set(
          `${event.eventId}|${tick}`,
          sample
        );
      }
    }
  );


  // ==========================================================
  // COMPLETE DAMAGE MESSAGES
  // ==========================================================

  parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
      demoPacket,
      messagePacket
    ) => {

      const tick =
        finite(
          demoPacket?.tick
        );


      if (
        tick ===
        null
      ) {

        return;
      }


      messagePackets++;


      const typeText =
        decodeMessageTypeText(
          messagePacket?.type
        );


      const typeNumber =
        decodeMessageTypeNumber(
          messagePacket?.type
        );


      if (
        !isDamageMessage(
          typeText,
          typeNumber
        )
      ) {

        return;
      }


      damageLikeMessages++;


      increment(
        damageMessageTypeCounts,
        typeText ??
        `MESSAGE_ID_${typeNumber ?? 'UNKNOWN'}`
      );


      const data =
        getMessageData(
          messagePacket
        );


      for (
        const field
        of collectObjectKeys(
          data,
          2
        )
      ) {

        damageMessageFieldNames.add(
          field
        );
      }


      const victimRaw =
        findEntityReference(
          data,
          [
            /entindexvictim/i,
            /entindex_victim/i,
            /victimentityindex/i,
            /victim_entity_index/i,
            /victimindex/i,
            /^victim$/i,
            /hvictim/i
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

        return;
      }


      damageMessagesWithVictim++;


      if (
        !targetEntityIndexes.has(
          victimEntityIndex
        )
      ) {

        return;
      }


      targetVictimDamageMessages++;


      const matches =
        matchEventsAtTick({

          rows:
            eventsByEntity.get(
              victimEntityIndex
            )
            ??
            [],

          tick,

          beforeTicks:
            DAMAGE_MATCH_BEFORE_TICKS,

          afterTicks:
            DAMAGE_MATCH_AFTER_TICKS
        });


      if (
        matches.length ===
        0
      ) {

        return;
      }


      if (
        matches.length >
        1
      ) {

        ambiguousDamageMatches++;
      }


      const event =
        chooseBestEvent(
          matches,
          tick
        );


      if (
        !event
      ) {

        return;
      }


      matchedDamageMessages++;


      const attackerRaw =
        findEntityReference(
          data,
          [
            /entindexattacker/i,
            /entindex_attacker/i,
            /attackerentityindex/i,
            /attacker_entity_index/i,
            /attackerindex/i,
            /^attacker$/i,
            /hattacker/i
          ]
        );


      const attackerEntityIndex =
        normalizeEntityReference(
          attackerRaw
        );


      const attackerPlayer =
        attackerEntityIndex ===
        null
          ? null
          : playerByPawnIndex.get(
              attackerEntityIndex
            )
            ??
            null;


      if (
        attackerPlayer
      ) {

        playerAttributedHits++;
      }


      const attackerTeam =
        finite(
          attackerPlayer?.team
        );


      let relation =
        'RELATION_UNRESOLVED';


      if (
        isGameTeam(
          attackerTeam
        )
        &&
        isGameTeam(
          finite(
            event.orbTeam
          )
        )
      ) {

        relation =
          attackerTeam ===
          Number(
            event.orbTeam
          )
            ? 'DENY_HIT'
            : 'SECURE_HIT';


        roleResolvedHits++;
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
          : tick -
            attackableStartTick;


      const ticksBeforeAttackableEnd =
        attackableEndTick ===
        null
          ? null
          : attackableEndTick -
            tick;


      const insideExactAttackableWindow =
        attackableStartTick !==
        null
        &&
        attackableEndTick !==
        null
        &&
        tick >=
        attackableStartTick
        &&
        tick <=
        attackableEndTick;


      const insideTolerantAttackableWindow =
        attackableStartTick !==
        null
        &&
        attackableEndTick !==
        null
        &&
        tick >=
        attackableStartTick -
        DAMAGE_MATCH_BEFORE_TICKS
        &&
        tick <=
        attackableEndTick +
        DAMAGE_MATCH_AFTER_TICKS;


      const serverTick =
        firstFinite(
          [

            data?.serverTick,

            data?.server_tick,

            findNumberByKey(
              data,
              /server.*tick/i
            )
          ]
        );


      const origin =
        normalizeVector(
          firstDefined(
            [

              data?.origin,

              data?.impactPosition,

              data?.impact_position,

              findValueByKeyPatterns(
                data,
                [
                  /^origin$/i,
                  /impact.*position/i
                ],
                4
              )?.value
            ]
          )
        );


      const damageDirection =
        normalizeVector(
          firstDefined(
            [

              data?.damageDirection,

              data?.damage_direction,

              findValueByKeyPatterns(
                data,
                [
                  /damage.*direction/i
                ],
                4
              )?.value
            ]
          )
        );


      damageHits.push(
        {

          schemaVersion:
            1,

          canonical:
            false,

          replay:
            replayName,

          eventId:
            event.eventId,

          orbEpisodeId:
            event.orbEpisodeId,

          orbEntityIndex:
            victimEntityIndex,

          orbTeam:
            finite(
              event.orbTeam
            ),

          sourceDeathId:
            event.sourceDeathId,

          sourceDeathTick:
            finite(
              event.sourceDeathTick
            ),

          demoTick:
            tick,

          serverTick,

          attackerEntityIndex,

          attackerPlayerName:
            attackerPlayer?.playerName
            ??
            null,

          attackerTeam,

          attackerHeroId:
            finite(
              attackerPlayer?.heroId
            ),

          relation,

          attackableStartTick,

          attackableEndTick,

          ticksAfterAttackableStart,

          secondsAfterAttackableStart:
            Number.isFinite(
              ticksAfterAttackableStart
            )
              ? ticksAfterAttackableStart /
                TICK_RATE
              : null,

          ticksBeforeAttackableEnd,

          insideExactAttackableWindow,

          insideTolerantAttackableWindow,

          damage:
            firstFinite(
              [

                data?.damage,

                data?.flDamage,

                data?.amount,

                data?.damageAmount,

                findNumberByKey(
                  data,
                  /(^|_)damage$/i
                )
              ]
            ),

          healthLost:
            firstFinite(
              [

                data?.healthLost,

                data?.health_lost,

                findNumberByKey(
                  data,
                  /health.*lost/i
                )
              ]
            ),

          victimHealthNew:
            firstFinite(
              [

                data?.victimHealthNew,

                data?.victim_health_new,

                findNumberByKey(
                  data,
                  /victim.*health.*new/i
                )
              ]
            ),

          genericDamageType:
            firstFinite(
              [

                data?.type,

                data?.damageType,

                data?.damage_type
              ]
            ),

          citadelDamageType:
            firstFinite(
              [

                data?.citadelType,

                data?.citadel_type,

                findNumberByKey(
                  data,
                  /citadel.*type/i
                )
              ]
            ),

          abilityId:
            firstFinite(
              [

                data?.abilityId,

                data?.ability_id,

                findNumberByKey(
                  data,
                  /ability.*id/i
                )
              ]
            ),

          origin,

          damageDirection,

          messageType:
            typeText,

          messageTypeNumber:
            typeNumber
        }
      );
    }
  );


  // ----------------------------------------------------------
  // PARSE RAW REPLAY
  // ----------------------------------------------------------

  console.log(
    'Parsing target CItemXP trajectory + all Damage messages...'
  );


  console.log(
    `[${new Date().toISOString()}] Parse started`
  );


  await parser.parse(
    createReadStream(
      replayPath
    )
  );


  await parser.dispose();


  // ----------------------------------------------------------
  // FINALIZE TRAJECTORY / HITS
  // ----------------------------------------------------------

  const trajectory =
    [
      ...trajectoryByEventTick.values()
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.tick -
          b.tick
          ||
          a.eventId.localeCompare(
            b.eventId
          )
      );


  damageHits.sort(
    (
      a,
      b
    ) =>
      a.demoTick -
      b.demoTick
      ||
      a.eventId.localeCompare(
        b.eventId
      )
  );


  // ----------------------------------------------------------
  // EVENT-LEVEL COVERAGE
  // ----------------------------------------------------------

  const trajectoryByEvent =
    groupBy(
      trajectory,
      row =>
        row.eventId
    );


  const hitsByEvent =
    groupBy(
      damageHits,
      row =>
        row.eventId
    );


  const eventCoverage =
    [];


  for (
    const event
    of temporalEvents
  ) {

    const samples =
      trajectoryByEvent.get(
        event.eventId
      )
      ??
      [];


    const positionSamples =
      samples.filter(
        row =>
          row.position
      );


    const hits =
      hitsByEvent.get(
        event.eventId
      )
      ??
      [];


    const sortedSamples =
      [
        ...samples
      ]
        .sort(
          (
            a,
            b
          ) =>
            a.tick -
            b.tick
        );


    const tickGaps =
      [];


    for (
      let i =
        1;

      i <
        sortedSamples.length;

      i++
    ) {

      tickGaps.push(
        sortedSamples[i].tick -
        sortedSamples[i - 1].tick
      );
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


    const attackablePositionSamples =
      positionSamples.filter(
        row =>
          attackableStartTick !==
          null
          &&
          attackableEndTick !==
          null
          &&
          row.tick >=
          attackableStartTick
          &&
          row.tick <=
          attackableEndTick
      );


    eventCoverage.push(
      {

        schemaVersion:
          1,

        canonical:
          false,

        replay:
          replayName,

        eventId:
          event.eventId,

        orbEpisodeId:
          event.orbEpisodeId,

        orbEntityIndex:
          finite(
            event.orbEntityIndex
          ),

        orbTeam:
          finite(
            event.orbTeam
          ),

        startTick:
          finite(
            event.startTick
          ),

        attackableStartTick,

        attackableEndTick,

        endTick:
          finite(
            event.endTick
          ),

        trajectorySamples:
          samples.length,

        positionSamples:
          positionSamples.length,

        attackablePositionSamples:
          attackablePositionSamples.length,

        firstTrajectoryTick:
          sortedSamples[0]?.tick
          ??
          null,

        lastTrajectoryTick:
          sortedSamples[
            sortedSamples.length -
            1
          ]?.tick
          ??
          null,

        firstPositionTick:
          positionSamples[0]?.tick
          ??
          null,

        lastPositionTick:
          positionSamples[
            positionSamples.length -
            1
          ]?.tick
          ??
          null,

        trajectoryTickGap:
          summarizeNumbers(
            tickGaps
          ),

        damageHits:
          hits.length,

        secureHits:
          hits.filter(
            row =>
              row.relation ===
              'SECURE_HIT'
          ).length,

        denyHits:
          hits.filter(
            row =>
              row.relation ===
              'DENY_HIT'
          ).length,

        unresolvedHits:
          hits.filter(
            row =>
              row.relation ===
              'RELATION_UNRESOLVED'
          ).length
      }
    );
  }


  // ----------------------------------------------------------
  // TRAJECTORY COVERAGE
  // ----------------------------------------------------------

  const eventsWithTrajectory =
    eventCoverage.filter(
      row =>
        row.trajectorySamples >
        0
    );


  const eventsWithPosition =
    eventCoverage.filter(
      row =>
        row.positionSamples >
        0
    );


  const eventsWithAttackablePosition =
    eventCoverage.filter(
      row =>
        row.attackablePositionSamples >
        0
    );


  const trajectoryEventCoverageRate =
    rate(
      eventsWithTrajectory.length,
      eventCoverage.length
    );


  const positionEventCoverageRate =
    rate(
      eventsWithPosition.length,
      eventCoverage.length
    );


  const attackablePositionEventCoverageRate =
    rate(
      eventsWithAttackablePosition.length,
      eventCoverage.length
    );


  // ----------------------------------------------------------
  // TRAJECTORY GAP DISTRIBUTION
  // ----------------------------------------------------------

  const trajectoryTickGaps =
    [];


  for (
    const row
    of eventCoverage
  ) {

    const samples =
      trajectoryByEvent.get(
        row.eventId
      )
      ??
      [];


    for (
      let i =
        1;

      i <
        samples.length;

      i++
    ) {

      trajectoryTickGaps.push(
        samples[i].tick -
        samples[i - 1].tick
      );
    }
  }


  // ----------------------------------------------------------
  // DAMAGE SUMMARY
  // ----------------------------------------------------------

  const secureHits =
    damageHits.filter(
      row =>
        row.relation ===
        'SECURE_HIT'
    );


  const denyHits =
    damageHits.filter(
      row =>
        row.relation ===
        'DENY_HIT'
    );


  const unresolvedHits =
    damageHits.filter(
      row =>
        row.relation ===
        'RELATION_UNRESOLVED'
    );


  const exactAttackableHits =
    damageHits.filter(
      row =>
        row.insideExactAttackableWindow
    );


  const tolerantAttackableHits =
    damageHits.filter(
      row =>
        row.insideTolerantAttackableWindow
    );


  const shotEpisodeIds =
    new Set(
      damageHits.map(
        row =>
          row.eventId
      )
    );


  const secureEpisodeIds =
    new Set(
      secureHits.map(
        row =>
          row.eventId
      )
    );


  const denyEpisodeIds =
    new Set(
      denyHits.map(
        row =>
          row.eventId
      )
    );


  const mixedRoleEpisodeIds =
    new Set(
      [
        ...secureEpisodeIds
      ].filter(
        id =>
          denyEpisodeIds.has(
            id
          )
      )
    );


  const playerAttributionRate =
    rate(
      playerAttributedHits,
      damageHits.length
    );


  const roleResolutionRate =
    rate(
      roleResolvedHits,
      damageHits.length
    );


  const exactAttackableHitRate =
    rate(
      exactAttackableHits.length,
      damageHits.length
    );


  const tolerantAttackableHitRate =
    rate(
      tolerantAttackableHits.length,
      damageHits.length
    );


  const secureSecondsAfterAttackableStart =
    secureHits
      .map(
        row =>
          row.secondsAfterAttackableStart
      )
      .filter(
        Number.isFinite
      );


  const denySecondsAfterAttackableStart =
    denyHits
      .map(
        row =>
          row.secondsAfterAttackableStart
      )
      .filter(
        Number.isFinite
      );


  // ----------------------------------------------------------
  // COMPACT-vs-FULL DIAGNOSTIC
  // ----------------------------------------------------------

  const compactVsFull =
    {

      compactMatchedHits,

      fullMatchedHits:
        damageHits.length,

      fullMinusCompact:
        damageHits.length -
        compactMatchedHits,

      fullToCompactRatio:
        compactMatchedHits >
        0
          ? damageHits.length /
            compactMatchedHits
          : null,

      interpretation:
        'Script102 compact hit count is a replication-oriented subset; Script115 is the comprehensive target-orb Damage extraction.'
    };


  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const checks =
    {

      sourceEventsPresent:
        {

          actual:
            temporalEvents.length,

          expected:
            '>0',

          pass:
            temporalEvents.length >
            0
        },


      trajectoryEventCoverage:
        {

          actual:
            trajectoryEventCoverageRate,

          expected:
            `>=${VALIDATION.minimumTrajectoryEventCoverage}`,

          pass:
            Number.isFinite(
              trajectoryEventCoverageRate
            )
            &&
            trajectoryEventCoverageRate >=
            VALIDATION.minimumTrajectoryEventCoverage
        },


      positionEventCoverage:
        {

          actual:
            positionEventCoverageRate,

          expected:
            `>=${VALIDATION.minimumPositionEventCoverage}`,

          pass:
            Number.isFinite(
              positionEventCoverageRate
            )
            &&
            positionEventCoverageRate >=
            VALIDATION.minimumPositionEventCoverage
        },


      damageChannelObserved:
        {

          actual:
            damageLikeMessages,

          expected:
            '>0',

          pass:
            damageLikeMessages >
            0
        },


      targetDamageObserved:
        {

          actual:
            damageHits.length,

          expected:
            '>0',

          pass:
            damageHits.length >
            0
        },


      playerAttribution:
        {

          actual:
            playerAttributionRate,

          expected:
            `>=${VALIDATION.minimumPlayerAttributionRate}`,

          pass:
            Number.isFinite(
              playerAttributionRate
            )
            &&
            playerAttributionRate >=
            VALIDATION.minimumPlayerAttributionRate
        },


      roleResolution:
        {

          actual:
            roleResolutionRate,

          expected:
            `>=${VALIDATION.minimumRoleResolutionRate}`,

          pass:
            Number.isFinite(
              roleResolutionRate
            )
            &&
            roleResolutionRate >=
            VALIDATION.minimumRoleResolutionRate
        },


      tolerantAttackableTiming:
        {

          actual:
            tolerantAttackableHitRate,

          expected:
            `>=${VALIDATION.minimumTolerantAttackableHitRate}`,

          pass:
            Number.isFinite(
              tolerantAttackableHitRate
            )
            &&
            tolerantAttackableHitRate >=
            VALIDATION.minimumTolerantAttackableHitRate
        }
    };


  const pass =
    Object.values(
      checks
    )
      .every(
        row =>
          row.pass
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


      sourceEvents:
        {

          total:
            temporalEvents.length,

          targetEntityIndexes:
            targetEntityIndexes.size
        },


      parserTelemetry:
        {

          entityPacketMutations,

          citemxpMutations,

          targetCItemXPMutations,

          targetTrajectoryMatches,

          targetTrajectoryAmbiguous,

          trajectoryPositionSamples,

          messagePackets,

          damageLikeMessages,

          damageMessagesWithVictim,

          targetVictimDamageMessages,

          matchedDamageMessages,

          ambiguousDamageMatches,

          damageMessageTypeCounts:
            mapToSortedObject(
              damageMessageTypeCounts
            ),

          damageMessageFieldNames:
            [
              ...damageMessageFieldNames
            ].sort()
        },


      trajectory:
        {

          samples:
            trajectory.length,

          positionSamples:
            trajectory.filter(
              row =>
                row.position
            ).length,

          eventsWithTrajectory:
            eventsWithTrajectory.length,

          eventsWithPosition:
            eventsWithPosition.length,

          eventsWithAttackablePosition:
            eventsWithAttackablePosition.length,

          totalEvents:
            eventCoverage.length,

          eventCoverageRate:
            trajectoryEventCoverageRate,

          positionEventCoverageRate,

          attackablePositionEventCoverageRate,

          samplesPerEvent:
            summarizeNumbers(
              eventCoverage.map(
                row =>
                  row.trajectorySamples
              )
            ),

          positionSamplesPerEvent:
            summarizeNumbers(
              eventCoverage.map(
                row =>
                  row.positionSamples
              )
            ),

          attackablePositionSamplesPerEvent:
            summarizeNumbers(
              eventCoverage.map(
                row =>
                  row.attackablePositionSamples
              )
            ),

          tickGaps:
            summarizeNumbers(
              trajectoryTickGaps
            )
        },


      damage:
        {

          matchedHits:
            damageHits.length,

          shotEpisodes:
            shotEpisodeIds.size,

          secureHits:
            secureHits.length,

          denyHits:
            denyHits.length,

          unresolvedHits:
            unresolvedHits.length,

          secureEpisodes:
            secureEpisodeIds.size,

          denyEpisodes:
            denyEpisodeIds.size,

          mixedRoleEpisodes:
            mixedRoleEpisodeIds.size,

          playerAttributedHits,

          playerAttributionRate,

          roleResolvedHits,

          roleResolutionRate,

          exactAttackableHits:
            exactAttackableHits.length,

          exactAttackableHitRate,

          tolerantAttackableHits:
            tolerantAttackableHits.length,

          tolerantAttackableHitRate,

          secureAfterAttackableStart:
            summarizeNumbers(
              secureSecondsAfterAttackableStart
            ),

          denyAfterAttackableStart:
            summarizeNumbers(
              denySecondsAfterAttackableStart
            ),

          compactVsFull
        },


      validation:
        {

          pass,

          checks
        },


      rawDistributions:
        {

          trajectorySamplesPerEvent:
            eventCoverage.map(
              row =>
                row.trajectorySamples
            ),

          positionSamplesPerEvent:
            eventCoverage.map(
              row =>
                row.positionSamples
            ),

          trajectoryTickGaps,

          secureSecondsAfterAttackableStart,

          denySecondsAfterAttackableStart
        },


      outputs:
        {

          trajectory:
            trajectoryOutputPath,

          hits:
            hitsOutputPath,

          eventCoverage:
            eventCoverageOutputPath,

          summary:
            replaySummaryPath
        }
    };


  // ----------------------------------------------------------
  // WRITE REPLAY OUTPUTS
  // ----------------------------------------------------------

  await writeJsonl(
    trajectoryOutputPath,
    trajectory
  );


  await writeJsonl(
    hitsOutputPath,
    damageHits
  );


  await writeJsonl(
    eventCoverageOutputPath,
    eventCoverage
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
// MATCH LOGICAL EPISODES AT A TICK
// ============================================================

function matchEventsAtTick({

  rows,

  tick,

  beforeTicks,

  afterTicks
}) {

  return rows.filter(
    event => {

      const startTick =
        finite(
          event.startTick
        );


      const endTick =
        finite(
          event.endTick
        );


      if (
        startTick ===
        null
        ||
        endTick ===
        null
      ) {

        return false;
      }


      return (
        tick >=
        startTick -
        beforeTicks
        &&
        tick <=
        endTick +
        afterTicks
      );
    }
  );
}


function chooseBestEvent(
  rows,
  tick
) {

  if (
    rows.length ===
    0
  ) {

    return null;
  }


  return [
    ...rows
  ]
    .sort(
      (
        a,
        b
      ) =>
        intervalDistance(
          tick,
          Number(
            a.startTick
          ),
          Number(
            a.endTick
          )
        )
        -
        intervalDistance(
          tick,
          Number(
            b.startTick
          ),
          Number(
            b.endTick
          )
        )
        ||
        Math.abs(
          tick -
          Number(
            a.startTick
          )
        )
        -
        Math.abs(
          tick -
          Number(
            b.startTick
          )
        )
    )[0];
}


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


    const existing =
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
          existing.team
          ??
          null,

        heroId:
          finite(
            row
              ?.controller
              ?.heroId
          )
          ??
          existing.heroId
          ??
          null,

        pawnEntityIndex:
          pawnIndex,

        controllerEntityIndex:
          finite(
            row
              ?.controller
              ?.entityIndex
          )
          ??
          existing.controllerEntityIndex
          ??
          null
      }
    );
  }


  return map;
}


// ============================================================
// MESSAGE IDENTIFICATION
// ============================================================

function isDamageMessage(
  typeText,
  typeNumber
) {

  if (
    typeNumber ===
    DAMAGE_MESSAGE_ID
  ) {

    return true;
  }


  const text =
    String(
      typeText ??
      ''
    );


  if (
    !/DAMAGE/i.test(
      text
    )
  ) {

    return false;
  }


  if (
    /RECENT.*DAMAGE/i.test(
      text
    )
    ||
    /DAMAGE.*SUMMARY/i.test(
      text
    )
    ||
    /TRIGGER.*DAMAGE/i.test(
      text
    )
    ||
    /BOSS.*DAMAGE/i.test(
      text
    )
  ) {

    return false;
  }


  return true;
}


function decodeMessageTypeText(
  type
) {

  if (
    type ===
    null
    ||
    type ===
    undefined
  ) {

    return null;
  }


  const candidates =
    [

      type?._code,

      type?.code,

      type?.name,

      type?._name,

      type?.typeName,

      type?.type_name,

      typeof type ===
      'string'
        ? type
        : null
    ];


  for (
    const candidate
    of candidates
  ) {

    if (
      candidate !==
      null
      &&
      candidate !==
      undefined
    ) {

      const text =
        String(
          candidate
        );


      if (
        text.length >
        0
        &&
        text !==
        '[object Object]'
      ) {

        return text;
      }
    }
  }


  const text =
    String(
      type
    );


  return text ===
    '[object Object]'
      ? null
      : text;
}


function decodeMessageTypeNumber(
  type
) {

  const candidates =
    [

      typeof type ===
      'number'
        ? type
        : null,

      type?._id,

      type?.id,

      type?._value,

      type?.value
    ];


  return firstFinite(
    candidates
  );
}


function getMessageData(
  packet
) {

  return packet?.data
    ??
    packet?.message
    ??
    packet?.payload
    ??
    packet?.body
    ??
    packet
    ??
    null;
}


// ============================================================
// MESSAGE OBJECT SEARCH
// ============================================================

function findEntityReference(
  object,
  patterns
) {

  const found =
    findValueByKeyPatterns(
      object,
      patterns,
      4
    );


  return found?.value
    ??
    null;
}


function findNumberByKey(
  object,
  pattern
) {

  const found =
    findValueByKeyPatterns(
      object,
      [
        pattern
      ],
      4
    );


  return finite(
    found?.value
  );
}


function findValueByKeyPatterns(
  root,
  patterns,
  maxDepth
) {

  if (
    root ===
    null
    ||
    root ===
    undefined
  ) {

    return null;
  }


  const seen =
    new Set();


  const queue =
    [
      {
        value:
          root,

        depth:
          0,

        path:
          ''
      }
    ];


  while (
    queue.length >
    0
  ) {

    const current =
      queue.shift();


    const value =
      current.value;


    if (
      value ===
      null
      ||
      value ===
      undefined
      ||
      typeof value !==
      'object'
    ) {

      continue;
    }


    if (
      seen.has(
        value
      )
    ) {

      continue;
    }


    seen.add(
      value
    );


    for (
      const [
        key,
        child
      ]
      of Object.entries(
        value
      )
    ) {

      const path =
        current.path
          ? `${current.path}.${key}`
          : key;


      if (
        patterns.some(
          pattern =>
            pattern.test(
              key
            )
        )
      ) {

        return {
          key,
          path,
          value:
            child
        };
      }


      if (
        current.depth <
        maxDepth
        &&
        child
        &&
        typeof child ===
        'object'
      ) {

        queue.push(
          {

            value:
              child,

            depth:
              current.depth +
              1,

            path
          }
        );
      }
    }
  }


  return null;
}


function collectObjectKeys(
  object,
  maximumDepth,
  depth =
    0,
  prefix =
    ''
) {

  if (
    !object
    ||
    typeof object !==
    'object'
    ||
    depth >
    maximumDepth
  ) {

    return [];
  }


  const output =
    [];


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      object
    )
  ) {

    const path =
      prefix
        ? `${prefix}.${key}`
        : key;


    output.push(
      path
    );


    if (
      value
      &&
      typeof value ===
      'object'
    ) {

      output.push(
        ...collectObjectKeys(
          value,
          maximumDepth,
          depth +
          1,
          path
        )
      );
    }
  }


  return output;
}


// ============================================================
// ENTITY HELPERS
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


function safeGetChanges(
  event
) {

  try {

    if (
      typeof event?.getChanges ===
      'function'
    ) {

      return event.getChanges();
    }

  } catch {}


  return event?.changes
    ??
    event?.changedFields
    ??
    event?.fields
    ??
    null;
}


function extractChangedFields(
  raw
) {

  if (
    raw ===
    null
    ||
    raw ===
    undefined
  ) {

    return [];
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
                ? row[0]
                : row?.fieldName
                  ??
                  row?.name
                  ??
                  row?.key
                  ??
                  row?.path
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


  if (
    typeof raw ===
    'object'
  ) {

    return Object.keys(
      raw
    );
  }


  return [];
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


  return entity.className
    ??
    entity?.class?.name
    ??
    entity?._className
    ??
    null;
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
      operation?._code
      ??
      operation?.code
      ??
      operation
      ??
      'UNKNOWN'
    ).toUpperCase();


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
// POSITION HELPERS
//
// Reuse the position strategy already employed in the CItemXP
// source-classification pipeline:
//
//   1. Source 2 cell + local vector
//   2. conventional origin fields
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

    const vector =
      normalizeVector(
        safeGetField(
          entity,
          fieldName
        )
      );


    if (
      vector
    ) {

      return vector;
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
        ? cellZ *
          512
          -
          16384
          +
          vecZ
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

    return normalizePosition(
      {

        x:
          value[0],

        y:
          value[1],

        z:
          value[2]
          ??
          0
      }
    );
  }


  if (
    typeof value ===
    'object'
  ) {

    return normalizePosition(
      {

        x:
          value.x
          ??
          value.X
          ??
          value[0],

        y:
          value.y
          ??
          value.Y
          ??
          value[1],

        z:
          value.z
          ??
          value.Z
          ??
          value[2]
          ??
          0
      }
    );
  }


  return null;
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
    );


  const y =
    finite(
      value.y
    );


  const z =
    finite(
      value.z
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
    z:
      z ??
      0
  };
}


// ============================================================
// ENTITY REFERENCE NORMALIZATION
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


function increment(
  map,
  key
) {

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
          b[1] -
          a[1]
          ||
          String(
            a[0]
          ).localeCompare(
            String(
              b[0]
            )
          )
      )
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


function scalarStringOrNull(
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
    'string'
    ||
    typeof value ===
    'number'
    ||
    typeof value ===
    'bigint'
  ) {

    return String(
      value
    );
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
      null;


    if (
      candidate !==
      null
      &&
      candidate !==
      undefined
    ) {

      return String(
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
    'TRAJECTORY'
  );


  console.log(
    `  source-linked events:       ${row.sourceEvents.total}`
  );


  console.log(
    `  trajectory samples:         ${row.trajectory.samples}`
  );


  console.log(
    `  events with trajectory:     ${row.trajectory.eventsWithTrajectory}/${row.trajectory.totalEvents} (${formatPercent(
      row.trajectory.eventCoverageRate
    )})`
  );


  console.log(
    `  events with position:       ${row.trajectory.eventsWithPosition}/${row.trajectory.totalEvents} (${formatPercent(
      row.trajectory.positionEventCoverageRate
    )})`
  );


  console.log(
    `  attackable pos coverage:    ${row.trajectory.eventsWithAttackablePosition}/${row.trajectory.totalEvents} (${formatPercent(
      row.trajectory.attackablePositionEventCoverageRate
    )})`
  );


  console.log(
    `  samples/event median:       ${formatNumber(
      row.trajectory.samplesPerEvent.median
    )}`
  );


  console.log(
    `  tick-gap median:            ${formatNumber(
      row.trajectory.tickGaps.median
    )}`
  );


  console.log('');

  console.log(
    'FULL DAMAGE TELEMETRY'
  );


  console.log(
    `  damage-like messages:       ${row.parserTelemetry.damageLikeMessages}`
  );


  console.log(
    `  target-victim messages:     ${row.parserTelemetry.targetVictimDamageMessages}`
  );


  console.log(
    `  matched hits:               ${row.damage.matchedHits}`
  );


  console.log(
    `  compact Script114 hits:     ${row.damage.compactVsFull.compactMatchedHits}`
  );


  console.log(
    `  shot episodes:              ${row.damage.shotEpisodes}`
  );


  console.log(
    `  secure hits:                ${row.damage.secureHits}`
  );


  console.log(
    `  deny hits:                  ${row.damage.denyHits}`
  );


  console.log(
    `  player attribution:         ${row.damage.playerAttributedHits}/${row.damage.matchedHits} (${formatPercent(
      row.damage.playerAttributionRate
    )})`
  );


  console.log(
    `  role resolution:            ${row.damage.roleResolvedHits}/${row.damage.matchedHits} (${formatPercent(
      row.damage.roleResolutionRate
    )})`
  );


  console.log(
    `  exact attackable:           ${row.damage.exactAttackableHits}/${row.damage.matchedHits} (${formatPercent(
      row.damage.exactAttackableHitRate
    )})`
  );


  console.log(
    `  tolerant attackable:        ${row.damage.tolerantAttackableHits}/${row.damage.matchedHits} (${formatPercent(
      row.damage.tolerantAttackableHitRate
    )})`
  );


  console.log('');

  console.log(
    'VALIDATION'
  );


  for (
    const [
      name,
      check
    ]
    of Object.entries(
      row.validation.checks
    )
  ) {

    console.log(
      `  ${name.padEnd(28)} ${check.pass}`
    );
  }


  console.log('');

  console.log(
    `  PASS:                        ${row.validation.pass}`
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
    '# Flying-Soul Trajectory and Full-Hit Extraction'
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
    'This extraction creates the moving-orb geometry and comprehensive successful-hit substrate needed for player-specific soul opportunity modeling.'
  );


  lines.push('');


  lines.push(
    'It does **not** yet classify line of sight, weapon readiness, projectile travel time, missed responses, ignored opportunities, or optimal play.'
  );


  lines.push('');


  lines.push(
    '## Replay results'
  );


  lines.push('');


  for (
    const replay
    of summary.replays
  ) {

    lines.push(
      `### ${replay.replay}`
    );


    lines.push('');


    lines.push(
      `- Source-linked flying souls: ${replay.sourceEvents.total}`
    );


    lines.push(
      `- Trajectory event coverage: ${formatPercent(replay.trajectory.eventCoverageRate)}`
    );


    lines.push(
      `- Position event coverage: ${formatPercent(replay.trajectory.positionEventCoverageRate)}`
    );


    lines.push(
      `- Attackable-position event coverage: ${formatPercent(replay.trajectory.attackablePositionEventCoverageRate)}`
    );


    lines.push(
      `- Full matched hits: ${replay.damage.matchedHits}`
    );


    lines.push(
      `- Script114 compact matched hits: ${replay.damage.compactVsFull.compactMatchedHits}`
    );


    lines.push(
      `- Shot episodes: ${replay.damage.shotEpisodes}`
    );


    lines.push(
      `- Secure hits: ${replay.damage.secureHits}`
    );


    lines.push(
      `- Deny hits: ${replay.damage.denyHits}`
    );


    lines.push(
      `- Player attribution: ${formatPercent(replay.damage.playerAttributionRate)}`
    );


    lines.push(
      `- Role resolution: ${formatPercent(replay.damage.roleResolutionRate)}`
    );


    lines.push(
      `- Tolerant attackable hit rate: ${formatPercent(replay.damage.tolerantAttackableHitRate)}`
    );


    lines.push(
      `- Validation: **${replay.validation.pass ? 'PASS' : 'FAIL'}**`
    );


    lines.push('');
  }


  lines.push(
    '## Behavioral guardrail'
  );


  lines.push('');


  lines.push(
    'An observed successful Damage message is an outcome anchor. It does not reveal the exact trigger-pull time and therefore must not yet be treated as reaction time.'
  );


  lines.push('');


  lines.push(
    '## Next stage'
  );


  lines.push('');


  lines.push(
    summary.interpretation.nextStage
  );


  lines.push('');


  return lines.join(
    '\n'
  );
}