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

const TICK_RATE = 64;
const ENTITY_INDEX_MASK = 0x3fff;

const TROOPER_ORB_SUBCLASS = '494398941';
const URN_ORB_SUBCLASS = '3283937835';

const ATTACK_WINDOW_TOLERANCE_BEFORE_TICKS = 4;
const ATTACK_WINDOW_TOLERANCE_AFTER_TICKS = 8;
const LIFECYCLE_AFTER_END_TICKS = 96;

const MAX_DAMAGE_MESSAGE_SAMPLES = 100;
const MAX_UNMATCHED_DAMAGE_SAMPLES = 100;
const MAX_SPECIAL_MESSAGE_SAMPLES = 100;


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );

const episodeInputPath =
  resolve(
    'output',
    replayName,
    'citemxp_source_classification_v01.jsonl'
  );

const urnValidationPath =
  resolve(
    'output',
    replayName,
    'urn_citemxp_subclass_validation_v01.json'
  );

const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );

const summaryPath =
  resolve(
    'output',
    replayName,
    'citemxp_shot_outcome_validation_v01.json'
  );

const outcomePath =
  resolve(
    'output',
    replayName,
    'citemxp_shot_outcomes_v01.jsonl'
  );


// ============================================================
// INPUT CHECKS
// ============================================================

for (
  const path
  of [
    replayPath,
    episodeInputPath,
    urnValidationPath,
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
// LOAD URN VALIDATION
// ============================================================

const urnValidation =
  JSON.parse(
    readFileSync(
      urnValidationPath,
      'utf8'
    )
  );

if (
  urnValidation
    ?.validation
    ?.pass !==
  true
) {
  throw new Error(
    'Script 60 Urn subtype validation did not PASS.'
  );
}


// ============================================================
// LOAD SCRIPT 59 EPISODES
// ============================================================

console.log('');

console.log(
  'Loading source-classified CItemXP episodes...'
);

const rawEpisodeRows =
  await loadJsonl(
    episodeInputPath
  );

const normalizedEpisodes =
  rawEpisodeRows
    .map(
      normalizeEpisodeRow
    )
    .filter(
      Boolean
    );


// ============================================================
// BUILD VALIDATED URN EPISODE SET
// ============================================================

const urnBurstByEpisodeId =
  new Map();

for (
  const burst
  of urnValidation?.bursts ?? []
) {
  if (
    burst?.structuralSignaturePass !==
    true
  ) {
    continue;
  }

  for (
    const episodeId
    of burst.episodeIds ?? []
  ) {
    urnBurstByEpisodeId.set(
      episodeId,
      {
        burstId:
          burst.burstId,

        burstTeam:
          finite(
            burst.dominantTeam
          ),

        firstTick:
          finite(
            burst.firstTick
          ),

        firstClock:
          burst.firstClock ?? null,

        centroid:
          normalizePosition(
            burst.centroid
          )
      }
    );
  }
}


// ============================================================
// TARGET EPISODES
//
// TROOPER:
// Only one-to-one death-linked CItemXP episodes.
//
// URN:
// Only Script 60 structurally validated payout episodes.
// ============================================================

const targetEpisodes = [];

for (
  const episode
  of normalizedEpisodes
) {
  if (
    episode.subclassId ===
      TROOPER_ORB_SUBCLASS
    &&
    episode
      ?.source
      ?.type ===
      'TROOPER_DEATH'
  ) {
    targetEpisodes.push({
      ...episode,

      sourceType:
        'TROOPER_DEATH',

      sourceId:
        episode?.source?.sourceId ??
        episode?.source?.trooperDeathKey ??
        null,

      sourceTeam:
        finite(
          episode?.source?.trooperTeam
        ),

      urnBurst:
        null
    });

    continue;
  }

  if (
    episode.subclassId ===
      URN_ORB_SUBCLASS
    &&
    urnBurstByEpisodeId.has(
      episode.episodeId
    )
  ) {
    targetEpisodes.push({
      ...episode,

      sourceType:
        'URN_DELIVERY',

      sourceId:
        urnBurstByEpisodeId
          .get(
            episode.episodeId
          )
          .burstId,

      sourceTeam:
        null,

      urnBurst:
        urnBurstByEpisodeId.get(
          episode.episodeId
        )
    });
  }
}


for (
  let i = 0;
  i < targetEpisodes.length;
  i++
) {
  const episode =
    targetEpisodes[i];

  episode.targetIndex = i;

  episode.attackableStartTick =
    getAttackableStartTick(
      episode
    );

  episode.attackableEndTick =
    getAttackableEndTick(
      episode
    );

  episode.matchWindowStartTick =
    episode.attackableStartTick -
    ATTACK_WINDOW_TOLERANCE_BEFORE_TICKS;

  episode.matchWindowEndTick =
    episode.attackableEndTick +
    ATTACK_WINDOW_TOLERANCE_AFTER_TICKS;

  episode.lifecycleWindowEndTick =
    episode.attackableEndTick +
    LIFECYCLE_AFTER_END_TICKS;

  episode.damageEvents = [];
  episode.lifecycleEvents = [];
}


const trooperTargets =
  targetEpisodes.filter(
    row =>
      row.sourceType ===
      'TROOPER_DEATH'
  );

const urnTargets =
  targetEpisodes.filter(
    row =>
      row.sourceType ===
      'URN_DELIVERY'
  );

console.log(
  `Trooper target orbs: ${trooperTargets.length}`
);

console.log(
  `Urn target orbs: ${urnTargets.length}`
);


// ============================================================
// PLAYER PAWN IDENTITY
// ============================================================

console.log(
  'Loading player pawn identities...'
);

const playerByPawnIndex =
  await loadPlayerPawnMap(
    playerStatePath
  );

console.log(
  `Known player pawn indexes: ${playerByPawnIndex.size}`
);


// ============================================================
// TARGET INDEX BY ENTITY INDEX
// ============================================================

const targetsByEntityIndex =
  new Map();

for (
  const episode
  of targetEpisodes
) {
  pushMapArray(
    targetsByEntityIndex,
    episode.entityIndex,
    episode.targetIndex
  );
}

for (
  const indexes
  of targetsByEntityIndex.values()
) {
  indexes.sort(
    (
      a,
      b
    ) =>
      targetEpisodes[a].startTick -
      targetEpisodes[b].startTick
  );
}


// ============================================================
// TELEMETRY COUNTERS
// ============================================================

let messagePackets = 0;
let damageLikeMessages = 0;
let damageMessagesWithVictim = 0;
let damageMessagesMatchedTarget = 0;
let targetLifecycleEntityEvents = 0;

const damageMessageTypes =
  new Map();

const specialMessageTypes =
  new Map();

const damageMessageFieldNames =
  new Set();

const damageMessageSamples = [];
const unmatchedDamageSamples = [];
const specialMessageSamples = [];


// ============================================================
// PARSER
// ============================================================

const parser =
  new Parser();


// ============================================================
// MESSAGE PACKETS
// ============================================================

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

    const type =
      decodeMessageType(
        messagePacket?.type
      );

    if (
      !type
    ) {
      return;
    }

    const data =
      getMessageData(
        messagePacket
      );

    // --------------------------------------------------------
    // Discover any possibly explicit soul/orb reward messages.
    // --------------------------------------------------------

    if (
      /SOUL|ORB|XP|DENY|SECURE|CURRENCY|GOLD/i.test(
        type
      )
    ) {
      increment(
        specialMessageTypes,
        type
      );

      if (
        specialMessageSamples.length <
        MAX_SPECIAL_MESSAGE_SAMPLES
      ) {
        specialMessageSamples.push({
          tick,

          type,

          data:
            serializeValue(
              data
            )
        });
      }
    }

    // --------------------------------------------------------
    // Damage-like messages
    // --------------------------------------------------------

    if (
      !/DAMAGE/i.test(
        type
      )
    ) {
      return;
    }

    damageLikeMessages++;

    increment(
      damageMessageTypes,
      type
    );

    for (
      const key
      of collectObjectKeys(
        data,
        2
      )
    ) {
      damageMessageFieldNames.add(
        key
      );
    }

    const victimRaw =
      findEntityReference(
        data,
        [
          /entindexvictim/i,
          /entindex_victim/i,
          /victimentityindex/i,
          /victimindex/i,
          /^victim$/i,
          /hvictim/i
        ]
      );

    const attackerRaw =
      findEntityReference(
        data,
        [
          /entindexattacker/i,
          /entindex_attacker/i,
          /attackerentityindex/i,
          /attackerindex/i,
          /^attacker$/i,
          /hattacker/i
        ]
      );

    const victimIndex =
      normalizeEntityReference(
        victimRaw
      );

    const attackerIndex =
      normalizeEntityReference(
        attackerRaw
      );

    if (
      victimIndex ===
      null
    ) {
      return;
    }

    damageMessagesWithVictim++;

    const target =
      findTargetEpisodeForTick(
        victimIndex,
        tick,
        true
      );

    if (
      !target
    ) {
      if (
        unmatchedDamageSamples.length <
        MAX_UNMATCHED_DAMAGE_SAMPLES
      ) {
        unmatchedDamageSamples.push({
          tick,

          type,

          victimRaw:
            serializeValue(
              victimRaw
            ),

          victimIndex,

          attackerRaw:
            serializeValue(
              attackerRaw
            ),

          attackerIndex,

          data:
            serializeValue(
              data
            )
        });
      }

      return;
    }

    damageMessagesMatchedTarget++;

    const attackerPlayer =
      attackerIndex !==
      null
        ? playerByPawnIndex.get(
          attackerIndex
        ) ?? null
        : null;

    const event = {
      tick,

      type,

      victimRaw:
        serializeValue(
          victimRaw
        ),

      victimIndex,

      attackerRaw:
        serializeValue(
          attackerRaw
        ),

      attackerIndex,

      attackerPlayer,

      damage:
        firstFinite([
          data?.damage,
          data?.flDamage,
          data?.amount,
          data?.damageAmount,
          findNumberByKey(
            data,
            /(^|_)damage$/i
          )
        ]),

      healthLost:
        firstFinite([
          data?.healthLost,
          data?.health_lost,
          findNumberByKey(
            data,
            /health.*lost/i
          )
        ]),

      ticksAfterLaunch:
        tick -
        target.startTick,

      ticksAfterAttackableStart:
        tick -
        target.attackableStartTick,

      ticksBeforeAttackableEnd:
        target.attackableEndTick -
        tick,

      insideExactAttackableWindow:
        tick >=
          target.attackableStartTick
        &&
        tick <=
          target.attackableEndTick,

      insideTolerantAttackableWindow:
        tick >=
          target.matchWindowStartTick
        &&
        tick <=
          target.matchWindowEndTick
    };

    target.damageEvents.push(
      event
    );

    if (
      damageMessageSamples.length <
      MAX_DAMAGE_MESSAGE_SAMPLES
    ) {
      damageMessageSamples.push({
        targetEpisodeId:
          target.episodeId,

        sourceType:
          target.sourceType,

        ...event,

        data:
          serializeValue(
            data
          )
      });
    }
  }
);


// ============================================================
// ENTITY PACKETS
//
// Diagnostic only.
//
// LEAVE cannot automatically be called resolution because
// Source 2 PVS behavior can also generate LEAVE.
// ============================================================

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
      const event
      of events ?? []
    ) {
      const entity =
        event.entity;

      if (
        !entity
        ||
        getEntityClassName(
          entity
        ) !==
        'CItemXP'
      ) {
        continue;
      }

      const entityIndex =
        getEntityIndex(
          entity
        );

      if (
        entityIndex ===
        null
        ||
        !targetsByEntityIndex.has(
          entityIndex
        )
      ) {
        continue;
      }

      const target =
        findTargetEpisodeForTick(
          entityIndex,
          tick,
          false
        );

      if (
        !target
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

      if (
        operation ===
          'UPDATE'
        &&
        !changedFields.some(
          name =>
            /team|owner|launch|attackable|subclass/i.test(
              name
            )
        )
      ) {
        continue;
      }

      targetLifecycleEntityEvents++;

      target.lifecycleEvents.push({
        tick,

        operation,

        changedFields,

        team:
          finite(
            safeGetField(
              entity,
              'm_iTeamNum'
            )
          ),

        ownerEntity:
          serializeScalar(
            safeGetField(
              entity,
              'm_hOwnerEntity'
            )
          ),

        launchNum:
          finite(
            safeGetField(
              entity,
              'm_nLaunchNum'
            )
          ),

        subclassId:
          String(
            serializeScalar(
              safeGetField(
                entity,
                'm_nSubclassID'
              )
            ) ??
            'UNKNOWN'
          )
      });
    }
  }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
  '========================================='
);

console.log(
  'CITEMXP SHOT OUTCOME VALIDATION V0.1'
);

console.log(
  '========================================='
);

console.log('');

await parser.parse(
  createReadStream(
    replayPath
  )
);

await parser.dispose();


// ============================================================
// CLASSIFY OUTCOMES
// ============================================================

for (
  const episode
  of targetEpisodes
) {
  episode.damageEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );

  episode.lifecycleEvents.sort(
    (
      a,
      b
    ) =>
      a.tick -
      b.tick
  );

  const playerDamageEvents =
    episode.damageEvents.filter(
      row =>
        row.attackerPlayer
    );

  const firstPlayerDamage =
    playerDamageEvents[0] ??
    null;

  const firstDamage =
    episode.damageEvents[0] ??
    null;

  episode.firstDamage =
    firstDamage;

  episode.firstPlayerDamage =
    firstPlayerDamage;

  episode.shotObserved =
    Boolean(
      firstPlayerDamage
    );

  episode.playerDamageEventCount =
    playerDamageEvents.length;

  episode.allDamageEventCount =
    episode.damageEvents.length;

  episode.outcome =
    classifyEpisodeOutcome(
      episode
    );
}


// ============================================================
// SUMMARIES
// ============================================================

const trooperSummary =
  summarizeSourceOutcomes(
    trooperTargets
  );

const urnSummary =
  summarizeSourceOutcomes(
    urnTargets
  );

const allShotEpisodes =
  targetEpisodes.filter(
    row =>
      row.shotObserved
  );

const exactWindowShots =
  allShotEpisodes.filter(
    row =>
      row
        .firstPlayerDamage
        ?.insideExactAttackableWindow ===
      true
  );

const tolerantWindowShots =
  allShotEpisodes.filter(
    row =>
      row
        .firstPlayerDamage
        ?.insideTolerantAttackableWindow ===
      true
  );

const playerAttributedDamageMessages =
  targetEpisodes
    .flatMap(
      row =>
        row.damageEvents
    )
    .filter(
      row =>
        row.attackerPlayer
    );

const allMatchedDamageMessages =
  targetEpisodes.flatMap(
    row =>
      row.damageEvents
  );


// ============================================================
// URN BURST-LEVEL SHOT SUMMARY
// ============================================================

const urnBurstSummaryMap =
  new Map();

for (
  const episode
  of urnTargets
) {
  const burstId =
    episode.sourceId ??
    'UNKNOWN';

  if (
    !urnBurstSummaryMap.has(
      burstId
    )
  ) {
    urnBurstSummaryMap.set(
      burstId,
      {
        burstId,

        burstTeam:
          episode?.urnBurst?.burstTeam ??
          null,

        firstClock:
          episode?.urnBurst?.firstClock ??
          null,

        orbCount:
          0,

        shotCount:
          0,

        sameOrbTeamShots:
          0,

        opposingOrbTeamShots:
          0,

        unknownTeamShots:
          0,

        shooters:
          new Map()
      }
    );
  }

  const row =
    urnBurstSummaryMap.get(
      burstId
    );

  row.orbCount++;

  if (
    !episode.firstPlayerDamage
  ) {
    continue;
  }

  row.shotCount++;

  const relation =
    getShooterRelationToOrbTeam(
      episode
    );

  if (
    relation ===
    'SAME_ORB_TEAM'
  ) {
    row.sameOrbTeamShots++;

  } else if (
    relation ===
    'OPPOSING_ORB_TEAM'
  ) {
    row.opposingOrbTeamShots++;

  } else {
    row.unknownTeamShots++;
  }

  const name =
    episode
      .firstPlayerDamage
      ?.attackerPlayer
      ?.playerName ??
    'UNKNOWN';

  increment(
    row.shooters,
    name
  );
}


const urnBurstSummaries =
  [
    ...urnBurstSummaryMap.values()
  ]
    .map(
      row => ({
        ...row,

        shotRate:
          rate(
            row.shotCount,
            row.orbCount
          ),

        shooters:
          mapToSortedObject(
            row.shooters
          )
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        String(
          a.burstId
        ).localeCompare(
          String(
            b.burstId
          )
        )
    );


// ============================================================
// VALIDATION
// ============================================================

const validation = {
  script60Passed:
    check(
      urnValidation
        ?.validation
        ?.pass,

      true,

      urnValidation
        ?.validation
        ?.pass ===
      true
    ),

  trooperTargetsLoaded:
    check(
      trooperTargets.length,

      1169,

      replayName ===
        'test'
        ? trooperTargets.length ===
          1169
        : trooperTargets.length >
          0
    ),

  urnTargetsLoaded:
    check(
      urnTargets.length,

      70,

      replayName ===
        'test'
        ? urnTargets.length ===
          70
        : urnTargets.length >
          0
    ),

  damageLikeMessagesObserved:
    check(
      damageLikeMessages,

      '>0',

      damageLikeMessages >
      0
    ),

  targetDamageObserved:
    check(
      allMatchedDamageMessages.length,

      '>0',

      allMatchedDamageMessages.length >
      0
    ),

  playerAttributionDominant:
    check(
      rate(
        playerAttributedDamageMessages.length,
        allMatchedDamageMessages.length
      ),

      '>=0.90',

      Number.isFinite(
        rate(
          playerAttributedDamageMessages.length,
          allMatchedDamageMessages.length
        )
      )
      &&
      rate(
        playerAttributedDamageMessages.length,
        allMatchedDamageMessages.length
      ) >=
      0.90
    ),

  shotTimingInsideTolerantWindow:
    check(
      rate(
        tolerantWindowShots.length,
        allShotEpisodes.length
      ),

      '>=0.90',

      Number.isFinite(
        rate(
          tolerantWindowShots.length,
          allShotEpisodes.length
        )
      )
      &&
      rate(
        tolerantWindowShots.length,
        allShotEpisodes.length
      ) >=
      0.90
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
// WRITE OUTCOMES
// ============================================================

mkdirSync(
  dirname(
    outcomePath
  ),
  {
    recursive:
      true
  }
);

const writer =
  createWriteStream(
    outcomePath,
    {
      encoding:
        'utf8'
    }
  );

for (
  const episode
  of targetEpisodes
) {
  writer.write(
    JSON.stringify({
      schemaVersion:
        1,

      canonical:
        false,

      sourceType:
        episode.sourceType,

      sourceId:
        episode.sourceId,

      episode:
        {
          episodeId:
            episode.episodeId,

          entityIndex:
            episode.entityIndex,

          subclassId:
            episode.subclassId,

          orbTeam:
            episode.team,

          startTick:
            episode.startTick,

          startClock:
            episode.startClock,

          startPosition:
            episode.startPosition,

          attackableStartTick:
            episode.attackableStartTick,

          attackableEndTick:
            episode.attackableEndTick,

          attackableDurationSeconds:
            episode.attackableDurationSeconds,

          firstLeaveTick:
            episode.firstLeaveTick
        },

      source:
        episode.source,

      urnBurst:
        episode.urnBurst,

      firstDamage:
        episode.firstDamage,

      firstPlayerDamage:
        episode.firstPlayerDamage,

      allDamageEvents:
        episode.damageEvents,

      lifecycleEvents:
        episode.lifecycleEvents,

      outcome:
        episode.outcome
    }) +
    '\n'
  );
}

await finishWriter(
  writer
);


// ============================================================
// SUMMARY
// ============================================================

const summary = {
  replay:
    replayName,

  version:
    'CITEMXP_SHOT_OUTCOME_VALIDATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'SHOT_OUTCOME_SIGNAL_VALIDATED'
      : 'DIAGNOSTIC_ONLY',

  sourceDefinitions:
    {
      trooper:
        {
          subclassId:
            TROOPER_ORB_SUBCLASS,

          inclusionRule:
            'Only Script 59 one-to-one TROOPER_DEATH-linked CItemXP episodes.',

          semantics:
            'Orb team equals dead Trooper team. Same-orb-team shooter is therefore a DENY candidate; opposing-orb-team shooter is a SECURE candidate.'
        },

      urn:
        {
          subclassId:
            URN_ORB_SUBCLASS,

          inclusionRule:
            'Only Script 60 structural Soul Urn payout bursts.',

          semantics:
            'Same-orb-team versus opposing-orb-team is reported directly. Based on the shared contestable-orb pattern, same-orb-team is provisionally treated as DENY and opposing-orb-team as CLAIM, but this remains provisional until reward ownership is independently linked.'
        }
    },

  telemetry:
    {
      messagePackets,

      damageLikeMessages,

      damageMessagesWithVictim,

      damageMessagesMatchedTarget,

      targetLifecycleEntityEvents,

      damageMessageTypes:
        mapToSortedObject(
          damageMessageTypes
        ),

      damageMessageFieldNames:
        [
          ...damageMessageFieldNames
        ].sort(),

      specialMessageTypes:
        mapToSortedObject(
          specialMessageTypes
        )
    },

  targets:
    {
      trooper:
        trooperTargets.length,

      urn:
        urnTargets.length,

      total:
        targetEpisodes.length
    },

  outcomes:
    {
      trooper:
        trooperSummary,

      urn:
        urnSummary,

      all:
        summarizeSourceOutcomes(
          targetEpisodes
        )
    },

  shotTiming:
    {
      shotEpisodes:
        allShotEpisodes.length,

      exactAttackableWindowShots:
        exactWindowShots.length,

      exactAttackableWindowRate:
        rate(
          exactWindowShots.length,
          allShotEpisodes.length
        ),

      tolerantAttackableWindowShots:
        tolerantWindowShots.length,

      tolerantAttackableWindowRate:
        rate(
          tolerantWindowShots.length,
          allShotEpisodes.length
        ),

      ticksAfterAttackableStart:
        summarizeNumbers(
          allShotEpisodes.map(
            row =>
              row
                .firstPlayerDamage
                ?.ticksAfterAttackableStart
          )
        ),

      secondsAfterAttackableStart:
        summarizeNumbers(
          allShotEpisodes.map(
            row =>
              Number.isFinite(
                row
                  .firstPlayerDamage
                  ?.ticksAfterAttackableStart
              )
                ? row
                  .firstPlayerDamage
                  .ticksAfterAttackableStart /
                  TICK_RATE
                : null
          )
        )
    },

  playerAttribution:
    {
      matchedDamageMessages:
        allMatchedDamageMessages.length,

      playerAttributedDamageMessages:
        playerAttributedDamageMessages.length,

      playerAttributionRate:
        rate(
          playerAttributedDamageMessages.length,
          allMatchedDamageMessages.length
        ),

      shooters:
        mapToSortedObject(
          countBy(
            allShotEpisodes,
            row =>
              row
                .firstPlayerDamage
                ?.attackerPlayer
                ?.playerName ??
              'UNKNOWN'
          )
        )
    },

  urnBursts:
    urnBurstSummaries,

  diagnosticSamples:
    {
      matchedDamageMessages:
        damageMessageSamples,

      unmatchedDamageMessages:
        unmatchedDamageSamples,

      specialMessages:
        specialMessageSamples
    },

  validation:
    {
      pass:
        validationPass,

      checks:
        validation
    },

  interpretation:
    validationPass
      ? 'Player-shot telemetry can be linked to validated Trooper and Soul Urn CItemXP episodes. Shot-side relation can now be used for secure/deny/claim classification; untouched episodes remain separate until direct automatic-award evidence is identified.'
      : 'Inspect damage-message structure and failed validation checks before using shot-side outcomes.',

  nextStep:
    validationPass
      ? 'Validate untouched CItemXP resolution against direct soul/currency award telemetry so NO_SHOT_OBSERVED can be separated into AUTO_AWARD versus other lifecycle outcomes.'
      : 'Repair shot attribution before attempting automatic-award reconstruction.',

  outputs:
    {
      summary:
        summaryPath,

      outcomes:
        outcomePath
    }
};


mkdirSync(
  dirname(
    summaryPath
  ),
  {
    recursive:
      true
  }
);

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
  'SHOT OUTCOME RESULTS'
);

console.log(
  '--------------------'
);

console.log(
  `Damage-like messages: ${damageLikeMessages.toLocaleString()}`
);

console.log(
  `Matched target damage messages: ${allMatchedDamageMessages.length}`
);

console.log(
  `Shot target episodes: ${allShotEpisodes.length}/${targetEpisodes.length}`
);

console.log(
  `Player attribution: ${formatPercent(
    rate(
      playerAttributedDamageMessages.length,
      allMatchedDamageMessages.length
    )
  )}`
);

console.log(
  `Shots inside exact attackable window: ${formatPercent(
    rate(
      exactWindowShots.length,
      allShotEpisodes.length
    )
  )}`
);

console.log('');

printSourceSummary(
  'TROOPER',
  trooperSummary
);

console.log('');

printSourceSummary(
  'URN',
  urnSummary
);

console.log('');

console.log(
  'URN BURSTS'
);

console.log(
  '----------'
);

for (
  const burst
  of urnBurstSummaries
) {
  console.log(
    `${String(
      burst.burstId
    ).padEnd(
      12
    )} time=${String(
      burst.firstClock
    ).padStart(
      6
    )} orbTeam=${String(
      burst.burstTeam
    ).padStart(
      2
    )} shot=${String(
      burst.shotCount
    ).padStart(
      2
    )}/${String(
      burst.orbCount
    ).padStart(
      2
    )} same=${String(
      burst.sameOrbTeamShots
    ).padStart(
      2
    )} opp=${String(
      burst.opposingOrbTeamShots
    ).padStart(
      2
    )}`
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
    `${row.pass ? 'PASS' : 'FAIL'}  ${key.padEnd(
      40
    )} actual=${JSON.stringify(
      row.actual
    )} expected=${JSON.stringify(
      row.expected
    )}`
  );
}

console.log('');

console.log(
  `OVERALL: ${validationPass ? 'PASS' : 'FAIL'}`
);

console.log('');

console.log(
  `Summary:\n${summaryPath}`
);

console.log('');

console.log(
  `Outcomes:\n${outcomePath}`
);

console.log('');


// ============================================================
// OUTCOME CLASSIFICATION
// ============================================================

function classifyEpisodeOutcome(
  episode
) {
  const first =
    episode.firstPlayerDamage;

  if (
    !first
  ) {
    return {
      observed:
        'NO_PLAYER_SHOT_OBSERVED',

      shooterRelationToOrbTeam:
        null,

      provisionalGameplayOutcome:
        'UNTOUCHED_OR_UNRESOLVED',

      confidence:
        'UNRESOLVED'
    };
  }

  const relation =
    getShooterRelationToOrbTeam(
      episode
    );

  if (
    episode.sourceType ===
    'TROOPER_DEATH'
  ) {
    if (
      relation ===
      'SAME_ORB_TEAM'
    ) {
      return {
        observed:
          'PLAYER_SHOT',

        shooterRelationToOrbTeam:
          relation,

        provisionalGameplayOutcome:
          'DENY',

        confidence:
          'HIGH'
      };
    }

    if (
      relation ===
      'OPPOSING_ORB_TEAM'
    ) {
      return {
        observed:
          'PLAYER_SHOT',

        shooterRelationToOrbTeam:
          relation,

        provisionalGameplayOutcome:
          'SECURE',

        confidence:
          'HIGH'
      };
    }
  }

  if (
    episode.sourceType ===
    'URN_DELIVERY'
  ) {
    if (
      relation ===
      'SAME_ORB_TEAM'
    ) {
      return {
        observed:
          'PLAYER_SHOT',

        shooterRelationToOrbTeam:
          relation,

        provisionalGameplayOutcome:
          'DENY_CANDIDATE',

        confidence:
          'MODERATE'
      };
    }

    if (
      relation ===
      'OPPOSING_ORB_TEAM'
    ) {
      return {
        observed:
          'PLAYER_SHOT',

        shooterRelationToOrbTeam:
          relation,

        provisionalGameplayOutcome:
          'CLAIM_CANDIDATE',

        confidence:
          'MODERATE'
      };
    }
  }

  return {
    observed:
      'PLAYER_SHOT',

    shooterRelationToOrbTeam:
      relation,

    provisionalGameplayOutcome:
      'SHOT_OUTCOME_TEAM_RELATION_UNRESOLVED',

    confidence:
      'LOW'
  };
}


function getShooterRelationToOrbTeam(
  episode
) {
  const shooterTeam =
    finite(
      episode
        .firstPlayerDamage
        ?.attackerPlayer
        ?.team
    );

  const orbTeam =
    finite(
      episode.team
    );

  if (
    !isGameTeam(
      shooterTeam
    )
    ||
    !isGameTeam(
      orbTeam
    )
  ) {
    return 'UNKNOWN';
  }

  return shooterTeam ===
    orbTeam
    ? 'SAME_ORB_TEAM'
    : 'OPPOSING_ORB_TEAM';
}


function summarizeSourceOutcomes(
  rows
) {
  const shotRows =
    rows.filter(
      row =>
        row.shotObserved
    );

  const sameTeam =
    shotRows.filter(
      row =>
        getShooterRelationToOrbTeam(
          row
        ) ===
        'SAME_ORB_TEAM'
    );

  const opposingTeam =
    shotRows.filter(
      row =>
        getShooterRelationToOrbTeam(
          row
        ) ===
        'OPPOSING_ORB_TEAM'
    );

  const unknownTeam =
    shotRows.filter(
      row =>
        getShooterRelationToOrbTeam(
          row
        ) ===
        'UNKNOWN'
    );

  return {
    episodes:
      rows.length,

    shotEpisodes:
      shotRows.length,

    noPlayerShotObserved:
      rows.length -
      shotRows.length,

    shotRate:
      rate(
        shotRows.length,
        rows.length
      ),

    sameOrbTeamShots:
      sameTeam.length,

    opposingOrbTeamShots:
      opposingTeam.length,

    unknownTeamShots:
      unknownTeam.length,

    outcomeCounts:
      mapToSortedObject(
        countBy(
          rows,
          row =>
            row
              .outcome
              ?.provisionalGameplayOutcome ??
            'UNKNOWN'
        )
      ),

    shooters:
      mapToSortedObject(
        countBy(
          shotRows,
          row =>
            row
              .firstPlayerDamage
              ?.attackerPlayer
              ?.playerName ??
            'UNKNOWN'
        )
      ),

    secondsAfterAttackableStart:
      summarizeNumbers(
        shotRows.map(
          row =>
            Number.isFinite(
              row
                .firstPlayerDamage
                ?.ticksAfterAttackableStart
            )
              ? row
                .firstPlayerDamage
                .ticksAfterAttackableStart /
                TICK_RATE
              : null
        )
      )
  };
}


function printSourceSummary(
  label,
  summary
) {
  console.log(
    label
  );

  console.log(
    '-'.repeat(
      label.length
    )
  );

  console.log(
    `Episodes: ${summary.episodes}`
  );

  console.log(
    `Shot: ${summary.shotEpisodes}/${summary.episodes} = ${formatPercent(
      summary.shotRate
    )}`
  );

  console.log(
    `Same orb team: ${summary.sameOrbTeamShots}`
  );

  console.log(
    `Opposing orb team: ${summary.opposingOrbTeamShots}`
  );

  console.log(
    `Unknown team: ${summary.unknownTeamShots}`
  );
}


// ============================================================
// TARGET MATCHING
// ============================================================

function findTargetEpisodeForTick(
  entityIndex,
  tick,
  damageWindowOnly
) {
  const indexes =
    targetsByEntityIndex.get(
      entityIndex
    ) ??
    [];

  let best =
    null;

  let bestDistance =
    Infinity;

  for (
    const targetIndex
    of indexes
  ) {
    const episode =
      targetEpisodes[
        targetIndex
      ];

    const minTick =
      damageWindowOnly
        ? episode.matchWindowStartTick
        : episode.startTick -
          2;

    const maxTick =
      damageWindowOnly
        ? episode.matchWindowEndTick
        : episode.lifecycleWindowEndTick;

    if (
      tick <
        minTick
      ||
      tick >
        maxTick
    ) {
      continue;
    }

    const referenceTick =
      damageWindowOnly
        ? episode.attackableStartTick
        : episode.startTick;

    const distance =
      Math.abs(
        tick -
        referenceTick
      );

    if (
      distance <
      bestDistance
    ) {
      best =
        episode;

      bestDistance =
        distance;
    }
  }

  return best;
}


function getAttackableStartTick(
  episode
) {
  if (
    Number.isFinite(
      episode.launchToAttackableSeconds
    )
  ) {
    return episode.startTick +
      Math.round(
        episode.launchToAttackableSeconds *
        TICK_RATE
      );
  }

  return episode.startTick;
}


function getAttackableEndTick(
  episode
) {
  if (
    Number.isFinite(
      episode.launchToEndAttackableSeconds
    )
  ) {
    return episode.startTick +
      Math.round(
        episode.launchToEndAttackableSeconds *
        TICK_RATE
      );
  }

  if (
    Number.isFinite(
      episode.attackableDurationSeconds
    )
  ) {
    return getAttackableStartTick(
      episode
    ) +
      Math.round(
        episode.attackableDurationSeconds *
        TICK_RATE
      );
  }

  return episode.startTick +
    TICK_RATE;
}


// ============================================================
// NORMALIZE EPISODE STREAM
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

  const entityIndex =
    finite(
      e.entityIndex
    );

  if (
    startTick ===
      null
    ||
    entityIndex ===
      null
  ) {
    return null;
  }

  return {
    episodeIndex:
      finite(
        e.episodeIndex
      ),

    episodeId:
      e.episodeId ??
      null,

    entityIndex,

    sequence:
      finite(
        e.sequence
      ),

    subclassId:
      String(
        e.subclassId ??
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
      ),

    startClock:
      e.startClock ??
      null,

    startPosition:
      normalizePosition(
        e.startPosition
      ),

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

    firstLeaveTick:
      finite(
        e.firstLeaveTick
      ),

    logicalEndTick:
      finite(
        e.logicalEndTick
      ),

    logicalEndReason:
      e.logicalEndReason ??
      null,

    source:
      row?.source ??
      null
  };
}


// ============================================================
// PLAYER MAP
// ============================================================

async function loadPlayerPawnMap(
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

    const pawnIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );

    const playerName =
      row
        ?.controller
        ?.playerName ??
      null;

    if (
      pawnIndex ===
        null
      ||
      !playerName
    ) {
      continue;
    }

    if (
      !result.has(
        pawnIndex
      )
    ) {
      result.set(
        pawnIndex,
        {
          playerName,

          team:
            finite(
              row
                ?.controller
                ?.team
            ),

          heroId:
            finite(
              row
                ?.controller
                ?.heroId
            ),

          pawnEntityIndex:
            pawnIndex,

          controllerEntityIndex:
            finite(
              row
                ?.controller
                ?.entityIndex
            )
        }
      );
    }
  }

  return result;
}


// ============================================================
// MESSAGE HELPERS
// ============================================================

function decodeMessageType(
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

  const code =
    type?._code ??
    type?.code ??
    null;

  if (
    code !==
      null
    &&
    code !==
      undefined
  ) {
    return String(
      code
    );
  }

  const id =
    type?._id ??
    type?.id ??
    null;

  if (
    id !==
      null
    &&
    id !==
      undefined
  ) {
    return `MESSAGE_ID_${id}`;
  }

  return String(
    type
  );
}


function getMessageData(
  packet
) {
  return packet?.data ??
    packet?.message ??
    packet?.payload ??
    packet ??
    null;
}


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

  return found?.value ??
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
  const seen =
    new Set();

  const queue = [
    {
      value:
        root,

      depth:
        0
    }
  ];

  while (
    queue.length
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
        nested
      ]
      of Object.entries(
        value
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
        return {
          key,

          value:
            nested
        };
      }

      if (
        current.depth <
          maxDepth
        &&
        nested !==
          null
        &&
        typeof nested ===
          'object'
      ) {
        queue.push({
          value:
            nested,

          depth:
            current.depth +
            1
        });
      }
    }
  }

  return null;
}


function normalizeEntityReference(
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
    'object'
  ) {
    for (
      const key
      of [
        'entityIndex',
        'entindex',
        'index',
        'handle',
        'value',
        'id'
      ]
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          value,
          key
        )
      ) {
        const normalized =
          normalizeEntityReference(
            value[key]
          );

        if (
          normalized !==
          null
        ) {
          return normalized;
        }
      }
    }

    return null;
  }

  const number =
    finite(
      value
    );

  if (
    number ===
    null
  ) {
    return null;
  }

  const integer =
    Math.trunc(
      number
    );

  if (
    integer >=
      0
    &&
    integer <=
      ENTITY_INDEX_MASK
  ) {
    return integer;
  }

  const masked =
    integer &
    ENTITY_INDEX_MASK;

  return masked >=
      0
    &&
    masked <=
      ENTITY_INDEX_MASK
    ? masked
    : null;
}


function collectObjectKeys(
  root,
  maxDepth
) {
  const result =
    new Set();

  const seen =
    new Set();

  const queue = [
    {
      value:
        root,

      depth:
        0,

      prefix:
        ''
    }
  ];

  while (
    queue.length
  ) {
    const current =
      queue.shift();

    if (
      current.value ===
        null
      ||
      typeof current.value !==
        'object'
    ) {
      continue;
    }

    if (
      seen.has(
        current.value
      )
    ) {
      continue;
    }

    seen.add(
      current.value
    );

    for (
      const [
        key,
        value
      ]
      of Object.entries(
        current.value
      )
    ) {
      const fullKey =
        current.prefix
          ? `${current.prefix}.${key}`
          : key;

      result.add(
        fullKey
      );

      if (
        current.depth <
          maxDepth
        &&
        value !==
          null
        &&
        typeof value ===
          'object'
      ) {
        queue.push({
          value,

          depth:
            current.depth +
            1,

          prefix:
            fullKey
        });
      }
    }
  }

  return [
    ...result
  ];
}


// ============================================================
// ENTITY HELPERS
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
    ].map(
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
                ? row[0]
                : row?.fieldName ??
                  row?.name ??
                  row?.key ??
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

  return typeof raw ===
    'object'
    ? Object.keys(
      raw
    )
    : [];
}


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

  return entity.className ??
    entity?.class?.name ??
    entity?._className ??
    null;
}


function getEntityIndex(
  entity
) {
  const direct =
    finite(
      entity?.index ??
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
      operation?._code ??
      operation?.code ??
      operation ??
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
// DATA HELPERS
// ============================================================

async function loadJsonl(
  path
) {
  const rows = [];

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


function pushMapArray(
  map,
  key,
  value
) {
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

  map
    .get(
      key
    )
    .push(
      value
    );
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
      ) ??
      0
    ) +
    1
  );
}


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
    increment(
      map,
      keyFn(
        row
      )
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
    ].sort(
      (
        a,
        b
      ) =>
        b[1] -
        a[1]
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
      ) /
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
    return sorted[lower];
  }

  const weight =
    position -
    lower;

  return sorted[lower] *
    (
      1 -
      weight
    ) +
    sorted[upper] *
    weight;
}


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
    ) ??
    0;

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


function serializeValue(
  value,
  seen = new WeakSet()
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

  if (
    typeof value !==
    'object'
  ) {
    return String(
      value
    );
  }

  if (
    seen.has(
      value
    )
  ) {
    return '[Circular]';
  }

  seen.add(
    value
  );

  if (
    Array.isArray(
      value
    )
  ) {
    return value.map(
      row =>
        serializeValue(
          row,
          seen
        )
    );
  }

  const result = {};

  for (
    const [
      key,
      nested
    ]
    of Object.entries(
      value
    )
  ) {
    result[key] =
      serializeValue(
        nested,
        seen
      );
  }

  return result;
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
    denominator ===
      0
  ) {
    return null;
  }

  return numerator /
    denominator;
}


function isGameTeam(
  value
) {
  return value ===
    2
    ||
    value ===
    3;
}


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


function formatPercent(
  value
) {
  return Number.isFinite(
    value
  )
    ? `${
      (
        value *
        100
      ).toFixed(
        2
      )
    }%`
    : 'n/a';
}


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