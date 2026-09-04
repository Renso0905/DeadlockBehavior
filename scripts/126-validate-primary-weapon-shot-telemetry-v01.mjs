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
  'PRIMARY_WEAPON_SHOT_TELEMETRY_VALIDATION_V01';


// ============================================================
// PURPOSE
//
// We already have observed successful CItemXP Damage impacts.
//
// Damage is an OUTCOME.
//
// This script independently reconstructs actual primary-weapon
// discharge signals from weapon entities using fields such as:
//
//   m_nShotNumber
//   m_flLastAttackTime
//   m_iClip
//   m_flNextPrimaryAttack
//   m_bInReload
//
// Then it asks:
//
//   Does the successful soul hitter have an observed weapon
//   discharge shortly BEFORE the soul Damage hit?
//
// This does NOT yet claim direct shot->hit attribution.
//
// Nearest preceding shot is a MATCH CANDIDATE only.
//
// No opportunity classification.
// No projectile-speed model.
// No trigger-input interpretation.
// ============================================================


// ============================================================
// SETTINGS
// ============================================================

const replayName =
  process.argv[2] ??
  'rep01';


const TICK_RATE =
  64;


const FIRING_ORIGIN_Z_PROXY_HU =
  64;


const MATCH_WINDOWS_TICKS =
  [
    8,
    16,
    32,
    64
  ];


const MAX_MATCH_WINDOW_TICKS =
  Math.max(
    ...MATCH_WINDOWS_TICKS
  );


const VALIDATION =
  {
    minimumPositiveAnchors:
      50,

    minimumPlayerLinkedShotEvents:
      100,

    minimumHitWithPrecedingShotWithin64Rate:
      0.90,

    minimumHeroAgreementRate:
      0.95
  };


// ============================================================
// PATHS
// ============================================================

const replayPath =
  resolve(
    'replays',
    `${replayName}.dem`
  );


const positiveAnchorPath =
  resolve(
    'output',
    replayName,
    'flying_soul_positive_actionability_anchors_v01.jsonl'
  );


const playerStatePath =
  resolve(
    'output',
    replayName,
    'player_state.jsonl'
  );


const outputSummaryPath =
  resolve(
    'output',
    replayName,
    'primary_weapon_shot_telemetry_validation_v01.json'
  );


const outputShotsPath =
  resolve(
    'output',
    replayName,
    'primary_weapon_shot_events_v01.jsonl'
  );


const outputMatchesPath =
  resolve(
    'output',
    replayName,
    'primary_weapon_soul_hit_matches_v01.jsonl'
  );


const outputMarkdownPath =
  resolve(
    'output',
    replayName,
    'primary_weapon_shot_telemetry_validation_v01.md'
  );


// ============================================================
// INPUT GUARDS
// ============================================================

for (
  const path
  of [
    replayPath,
    positiveAnchorPath,
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
// HEADER
// ============================================================

console.log('');

console.log(
  '========================================================'
);

console.log(
  'PRIMARY WEAPON SHOT TELEMETRY VALIDATION V0.1'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  `Replay:                  ${replayName}`
);

console.log(
  'Successful hit source:   Script116'
);

console.log(
  'Shot source:             primary-weapon entity telemetry'
);

console.log(
  'Direct shot attribution: NO'
);

console.log(
  'Projectile model:        NO'
);

console.log(
  'Opportunity labels:      NO'
);

console.log('');


// ============================================================
// LOAD POSITIVE HIT ANCHORS
// ============================================================

console.log(
  'Loading successful CItemXP hit anchors...'
);


const rawAnchors =
  await loadJsonl(
    positiveAnchorPath
  );


const anchors =
  rawAnchors
    .map(
      normalizePositiveAnchor
    )
    .filter(
      Boolean
    )
    .sort(
      (
        a,
        b
      ) =>
        a.hitTick -
        b.hitTick
        ||
        a.playerName.localeCompare(
          b.playerName
        )
    );


console.log(
  `Successful hit anchors:   ${anchors.length}`
);


// ============================================================
// LOAD PLAYER IDENTITY + 4 HZ POSITION TIMELINES
// ============================================================

console.log(
  'Loading player identity and position timelines...'
);


const playerData =
  await loadPlayerData(
    playerStatePath
  );


console.log(
  `Players:                  ${playerData.playerByName.size}`
);

console.log('');


// ============================================================
// WEAPON TELEMETRY
// ============================================================

const weaponStateByEntity =
  new Map();


const weaponMetadataByEntity =
  new Map();


const weaponEntityIndexes =
  new Set();


const playerLinkedWeaponEntityIndexes =
  new Set();


const unlinkedWeaponEntityIndexes =
  new Set();


const weaponClassCounts =
  new Map();


const weaponSubclassCounts =
  new Map();


const fieldMentionCounts =
  new Map();


const shotSignalCounts =
  new Map();


const shotEvents =
  [];


let weaponEntityEvents =
  0;


let candidateWeaponEvents =
  0;


// ============================================================
// RAW PARSE
// ============================================================

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
    ) {

      return;
    }


    const demo =
      parser.getDemo();


    for (
      const event
      of events ??
      []
    ) {

      const entity =
        event?.entity;


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
        !isPrimaryWeaponCandidate(
          entity,
          className
        )
      ) {

        continue;
      }


      candidateWeaponEvents++;


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


      weaponEntityEvents++;


      weaponEntityIndexes.add(
        entityIndex
      );


      increment(
        weaponClassCounts,
        className
        ??
        'UNKNOWN'
      );


      const changedFields =
        new Set(
          extractChangedFields(
            safeGetChanges(
              event
            )
          )
        );


      for (
        const fieldName
        of changedFields
      ) {

        if (
          isInterestingWeaponField(
            fieldName
          )
        ) {

          increment(
            fieldMentionCounts,
            fieldName
          );
        }
      }


      const current =
        readWeaponState(
          entity
        );


      if (
        current.subclassId !==
        null
      ) {

        increment(
          weaponSubclassCounts,
          String(
            current.subclassId
          )
        );
      }


      const identity =
        resolveWeaponPlayer({
          demo,
          weaponEntity:
            entity,
          playerData
        });


      if (
        identity
      ) {

        playerLinkedWeaponEntityIndexes.add(
          entityIndex
        );

      } else {

        unlinkedWeaponEntityIndexes.add(
          entityIndex
        );
      }


      if (
        !weaponMetadataByEntity.has(
          entityIndex
        )
      ) {

        weaponMetadataByEntity.set(
          entityIndex,
          {
            weaponEntityIndex:
              entityIndex,

            className,

            subclassId:
              current.subclassId,

            player:
              identity
          }
        );

      } else if (
        identity
      ) {

        const metadata =
          weaponMetadataByEntity.get(
            entityIndex
          );


        metadata.player =
          metadata.player
          ??
          identity;


        metadata.subclassId =
          metadata.subclassId
          ??
          current.subclassId;
      }


      const previous =
        weaponStateByEntity.get(
          entityIndex
        )
        ??
        null;


      const signals =
        compareWeaponState(
          previous,
          current
        );


      weaponStateByEntity.set(
        entityIndex,
        current
      );


      if (
        !signals.actualDischargeSignal
      ) {

        continue;
      }


      if (
        signals.shotNumberDelta >
        0
      ) {

        increment(
          shotSignalCounts,
          'SHOT_NUMBER_INCREMENT'
        );
      }


      if (
        signals.lastAttackTimeAdvanced
      ) {

        increment(
          shotSignalCounts,
          'LAST_ATTACK_TIME_ADVANCED'
        );
      }


      if (
        signals.clipDelta <
        0
      ) {

        increment(
          shotSignalCounts,
          'CLIP_DECREASE_SUPPORT'
        );
      }


      if (
        signals.firedRecentlyRise
      ) {

        increment(
          shotSignalCounts,
          'FIRED_RECENTLY_RISE_SUPPORT'
        );
      }


      const shotUnits =
        signals.shotNumberDelta >
        0
          ? signals.shotNumberDelta
          : 1;


      const shotEvent =
        {
          schemaVersion:
            1,

          canonical:
            false,

          replay:
            replayName,

          tick,

          timeSeconds:
            tick /
            TICK_RATE,

          weaponEntityIndex:
            entityIndex,

          weaponClass:
            className,

          weaponSubclassId:
            current.subclassId,

          player:
            identity,

          changedFields:
            [
              ...changedFields
            ].filter(
              isInterestingWeaponField
            ),

          signal:
            {
              actualDischargeSignal:
                true,

              shotNumberDelta:
                signals.shotNumberDelta,

              lastAttackTimeAdvanced:
                signals.lastAttackTimeAdvanced,

              clipDelta:
                signals.clipDelta,

              firedRecentlyRise:
                signals.firedRecentlyRise,

              shotUnits,

              confidence:
                classifyShotSignalConfidence(
                  signals
                )
            },

          state:
            current,

          previousState:
            previous
              ? compactPriorWeaponState(
                  previous
                )
              : null,

          semanticStatus:
            'OBSERVED_PRIMARY_WEAPON_DISCHARGE_SIGNAL_NOT_TARGET_ATTRIBUTED'
        };


      shotEvents.push(
        shotEvent
      );
    }
  }
);


console.log(
  'Parsing replay for primary-weapon entity telemetry...'
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


shotEvents.sort(
  (
    a,
    b
  ) =>
    a.tick -
    b.tick
    ||
    (
      a.weaponEntityIndex
      ??
      0
    ) -
    (
      b.weaponEntityIndex
      ??
      0
    )
);


// ============================================================
// PLAYER-LINKED SHOT INDEX
// ============================================================

const linkedShotEvents =
  shotEvents.filter(
    row =>
      row?.player?.playerName
  );


const shotsByPlayer =
  new Map();


for (
  const shot
  of linkedShotEvents
) {

  const playerName =
    shot.player.playerName;


  if (
    !shotsByPlayer.has(
      playerName
    )
  ) {

    shotsByPlayer.set(
      playerName,
      []
    );
  }


  shotsByPlayer
    .get(
      playerName
    )
    .push(
      shot
    );
}


console.log('');

console.log(
  'WEAPON TELEMETRY'
);

console.log(
  '----------------'
);

console.log(
  `Candidate weapon events:    ${candidateWeaponEvents}`
);

console.log(
  `Weapon entity events:       ${weaponEntityEvents}`
);

console.log(
  `Unique weapon entities:     ${weaponEntityIndexes.size}`
);

console.log(
  `Player-linked weapon entities:${playerLinkedWeaponEntityIndexes.size}`
);

console.log(
  `Observed discharge events:  ${shotEvents.length}`
);

console.log(
  `Player-linked discharges:   ${linkedShotEvents.length}`
);

console.log('');


// ============================================================
// MATCH SUCCESSFUL HITS TO PRECEDING SHOTS
// ============================================================

const matches =
  [];


for (
  let anchorIndex =
    0;

  anchorIndex <
    anchors.length;

  anchorIndex++
) {

  const anchor =
    anchors[
      anchorIndex
    ];


  const playerShots =
    shotsByPlayer.get(
      anchor.playerName
    )
    ??
    [];


  const candidateShots =
    collectPrecedingShots({
      shots:
        playerShots,

      hitTick:
        anchor.hitTick,

      maximumWindowTicks:
        MAX_MATCH_WINDOW_TICKS
    });


  const nearest =
    candidateShots.length >
    0
      ? candidateShots[
          candidateShots.length -
          1
        ]
      : null;


  const offsetTicks =
    nearest
      ? anchor.hitTick -
        nearest.tick
      : null;


  const shotPlayerState =
    nearest
      ? reconstructPlayerStateAtTick({
          rows:
            playerData
              .timelineByPlayer
              .get(
                anchor.playerName
              )
            ??
            [],

          tick:
            nearest.tick
        })
      : null;


  const shotOrigin =
    shotPlayerState?.position
      ? {
          x:
            shotPlayerState.position.x,

          y:
            shotPlayerState.position.y,

          z:
            shotPlayerState.position.z +
            FIRING_ORIGIN_Z_PROXY_HU
        }
      : null;


  const approximateShotToImpactDistanceHU =
    shotOrigin
    &&
    anchor.orbPosition
      ? distance3D(
          shotOrigin,
          anchor.orbPosition
        )
      : null;


  const impliedSpeedHUPerSecond =
    Number.isFinite(
      approximateShotToImpactDistanceHU
    )
    &&
    Number.isFinite(
      offsetTicks
    )
    &&
    offsetTicks >
    0
      ? approximateShotToImpactDistanceHU /
        (
          offsetTicks /
          TICK_RATE
        )
      : null;


  const windowCounts =
    {};


  for (
    const windowTicks
    of MATCH_WINDOWS_TICKS
  ) {

    windowCounts[
      String(
        windowTicks
      )
    ] =
      candidateShots.filter(
        shot =>
          anchor.hitTick -
          shot.tick <=
          windowTicks
      ).length;
  }


  const heroAgreement =
    nearest
    &&
    Number.isFinite(
      anchor.heroId
    )
    &&
    Number.isFinite(
      nearest?.player?.heroId
    )
      ? anchor.heroId ===
        nearest.player.heroId
      : null;


  matches.push(
    {
      schemaVersion:
        1,

      canonical:
        false,

      replay:
        replayName,

      anchorIndex,

      anchorId:
        anchor.anchorId,

      eventId:
        anchor.eventId,

      hit:
        {
          tick:
            anchor.hitTick,

          playerName:
            anchor.playerName,

          heroId:
            anchor.heroId,

          relation:
            anchor.relation,

          orbPosition:
            anchor.orbPosition
        },

      candidateShotCounts:
        windowCounts,

      precedingShotsWithin64:
        candidateShots
          .slice(
            -12
          )
          .map(
            shot =>
              compactShotCandidate(
                shot,
                anchor.hitTick
              )
          ),

      nearestPrecedingShot:
        nearest
          ? {
              ...compactShotCandidate(
                nearest,
                anchor.hitTick
              ),

              heroAgreement,

              shotPlayerPosition:
                shotPlayerState?.position
                ??
                null,

              shotPlayerPositionMethod:
                shotPlayerState?.method
                ??
                null,

              firingOriginZProxyHU:
                FIRING_ORIGIN_Z_PROXY_HU,

              approximateShotOrigin:
                shotOrigin,

              approximateShotToImpactDistanceHU,

              impliedSpeedHUPerSecond,

              semanticStatus:
                'NEAREST_PRECEDING_SAME_PLAYER_SHOT_CANDIDATE_NOT_DIRECTLY_ATTRIBUTED'
            }
          : null,

      interpretation:
        {
          directShotToHitAttribution:
            false,

          matchWithin8:
            Number.isFinite(
              offsetTicks
            )
            &&
            offsetTicks <=
            8,

          matchWithin16:
            Number.isFinite(
              offsetTicks
            )
            &&
            offsetTicks <=
            16,

          matchWithin32:
            Number.isFinite(
              offsetTicks
            )
            &&
            offsetTicks <=
            32,

          matchWithin64:
            Number.isFinite(
              offsetTicks
            )
            &&
            offsetTicks <=
            64
        }
    }
  );
}


// ============================================================
// SUMMARIES
// ============================================================

const hitsWithNearestShot =
  matches.filter(
    row =>
      row.nearestPrecedingShot
  );


const hitMatchRates =
  {};


for (
  const windowTicks
  of MATCH_WINDOWS_TICKS
) {

  const count =
    matches.filter(
      row =>
        row
          ?.interpretation
          ?.[
            `matchWithin${windowTicks}`
          ] ===
        true
    ).length;


  hitMatchRates[
    String(
      windowTicks
    )
  ] =
    {
      windowTicks,

      seconds:
        windowTicks /
        TICK_RATE,

      matched:
        count,

      total:
        matches.length,

      rate:
        rate(
          count,
          matches.length
        )
    };
}


const heroComparable =
  hitsWithNearestShot.filter(
    row =>
      row
        ?.nearestPrecedingShot
        ?.heroAgreement !==
      null
  );


const heroAgreements =
  heroComparable.filter(
    row =>
      row
        .nearestPrecedingShot
        .heroAgreement ===
      true
  );


const heroAgreementRate =
  rate(
    heroAgreements.length,
    heroComparable.length
  );


const nearestOffsets =
  hitsWithNearestShot.map(
    row =>
      row
        .nearestPrecedingShot
        .offsetTicks
  );


const nearestDistances =
  hitsWithNearestShot.map(
    row =>
      row
        .nearestPrecedingShot
        .approximateShotToImpactDistanceHU
  );


const impliedSpeeds =
  hitsWithNearestShot.map(
    row =>
      row
        .nearestPrecedingShot
        .impliedSpeedHUPerSecond
  );


const byHero =
  summarizeByHero(
    matches
  );


const byPlayer =
  summarizeShotsByPlayer(
    linkedShotEvents,
    anchors
  );


// ============================================================
// VALIDATION
// ============================================================

const shotWithin64Rate =
  hitMatchRates[
    '64'
  ]?.rate
  ??
  null;


const validationChecks =
  {
    positiveHitAnchorsAvailable:
      check(
        anchors.length,
        `>=${VALIDATION.minimumPositiveAnchors}`,
        anchors.length >=
        VALIDATION.minimumPositiveAnchors
      ),


    playerLinkedShotTelemetryObserved:
      check(
        linkedShotEvents.length,
        `>=${VALIDATION.minimumPlayerLinkedShotEvents}`,
        linkedShotEvents.length >=
        VALIDATION.minimumPlayerLinkedShotEvents
      ),


    successfulHitsHavePrecedingShotWithin64:
      check(
        shotWithin64Rate,
        `>=${VALIDATION.minimumHitWithPrecedingShotWithin64Rate}`,
        Number.isFinite(
          shotWithin64Rate
        )
        &&
        shotWithin64Rate >=
        VALIDATION.minimumHitWithPrecedingShotWithin64Rate
      ),


    nearestShotHeroIdentityAgrees:
      check(
        heroAgreementRate,
        `>=${VALIDATION.minimumHeroAgreementRate}`,
        Number.isFinite(
          heroAgreementRate
        )
        &&
        heroAgreementRate >=
        VALIDATION.minimumHeroAgreementRate
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


const status =
  validationPass
    ? 'PRIMARY_WEAPON_SHOT_TELEMETRY_STRONGLY_SUPPORTED'
    : 'PRIMARY_WEAPON_SHOT_TELEMETRY_REQUIRES_DIAGNOSIS';


const nextStage =
  validationPass
    ? 'CALIBRATE_HERO_SPECIFIC_SHOT_TO_HIT_TRAVEL_AND_WEAPON_READY_STATE'
    : 'DIAGNOSE_PRIMARY_WEAPON_SHOT_SIGNAL_AND_HIT_ALIGNMENT';


// ============================================================
// SUMMARY
// ============================================================

const summary =
  {
    replay:
      replayName,

    version:
      VERSION,

    canonical:
      false,

    status,

    purpose:
      [
        'Recover actual primary-weapon discharge signals independently of CItemXP Damage.',
        'Link weapon entities to owning players and heroes.',
        'Test whether known successful CItemXP hits are preceded by same-player weapon discharge telemetry.',
        'Preserve nearest-shot matching as candidate attribution rather than proof.',
        'Prepare a substrate for hero-specific projectile travel and weapon-ready modeling.'
      ],

    inputs:
      {
        replay:
          replayPath,

        positiveAnchors:
          positiveAnchorPath,

        playerState:
          playerStatePath
      },

    weaponTelemetry:
      {
        candidateWeaponEvents,

        weaponEntityEvents,

        uniqueWeaponEntities:
          weaponEntityIndexes.size,

        playerLinkedWeaponEntities:
          playerLinkedWeaponEntityIndexes.size,

        unlinkedWeaponEntities:
          unlinkedWeaponEntityIndexes.size,

        totalDischargeEvents:
          shotEvents.length,

        playerLinkedDischargeEvents:
          linkedShotEvents.length,

        weaponClassCounts:
          mapToSortedObject(
            weaponClassCounts
          ),

        weaponSubclassCounts:
          mapToSortedObject(
            weaponSubclassCounts
          ),

        changedFieldCounts:
          mapToSortedObject(
            fieldMentionCounts
          ),

        shotSignalCounts:
          mapToSortedObject(
            shotSignalCounts
          )
      },

    successfulHitAlignment:
      {
        successfulHitAnchors:
          anchors.length,

        hitsWithAnyPrecedingShotWithin64:
          hitsWithNearestShot.length,

        hitMatchRates,

        nearestPrecedingShotOffsetTicks:
          summarizeNumbers(
            nearestOffsets
          ),

        nearestPrecedingShotOffsetSeconds:
          summarizeNumbers(
            nearestOffsets.map(
              value =>
                Number.isFinite(
                  value
                )
                  ? value /
                    TICK_RATE
                  : null
            )
          ),

        approximateShotToImpactDistanceHU:
          summarizeNumbers(
            nearestDistances
          ),

        impliedSpeedHUPerSecondDiagnosticOnly:
          summarizeNumbers(
            impliedSpeeds
          ),

        heroComparableMatches:
          heroComparable.length,

        heroAgreement:
          heroAgreements.length,

        heroAgreementRate
      },

    byHero,

    byPlayer,

    semanticLimits:
      {
        damage:
          'CItemXP Damage is a successful impact/outcome anchor.',

        weaponDischarge:
          'm_nShotNumber / m_flLastAttackTime weapon telemetry is treated as observed actual weapon discharge, not target attribution.',

        nearestMatching:
          'The nearest preceding same-player shot is only a candidate source shot. Automatic weapons may produce multiple plausible preceding shots.',

        firingOrigin:
          `Shot-distance diagnostics use pawn position +${FIRING_ORIGIN_Z_PROXY_HU} HU as an operational firing-origin proxy, not an exact muzzle location.`,

        impliedSpeed:
          'Distance divided by nearest-shot tick offset is exploratory only and must not yet be treated as canonical projectile velocity.',

        triggerInput:
          'This script does not inspect USER_COMMAND input. A player pressing fire when the weapon cannot discharge remains a separate future attempt-level signal.'
      },

    validation:
      {
        pass:
          validationPass,

        thresholds:
          VALIDATION,

        checks:
          validationChecks
      },

    nextStage,

    outputs:
      {
        summary:
          outputSummaryPath,

        shots:
          outputShotsPath,

        matches:
          outputMatchesPath,

        markdown:
          outputMarkdownPath
      }
  };


// ============================================================
// WRITE
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


await writeJsonl(
  outputShotsPath,
  shotEvents
);


await writeJsonl(
  outputMatchesPath,
  matches
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
  'PRIMARY WEAPON SHOT TELEMETRY SUMMARY'
);

console.log(
  '========================================================'
);

console.log('');

console.log(
  'SHOT SIGNAL'
);

console.log(
  '-----------'
);

console.log(
  `Unique weapon entities:       ${weaponEntityIndexes.size}`
);

console.log(
  `Player-linked weapon entities:${playerLinkedWeaponEntityIndexes.size}`
);

console.log(
  `Discharge events:             ${shotEvents.length}`
);

console.log(
  `Player-linked discharges:     ${linkedShotEvents.length}`
);

console.log('');

console.log(
  'SUCCESSFUL SOUL HIT ALIGNMENT'
);

console.log(
  '-----------------------------'
);


for (
  const windowTicks
  of MATCH_WINDOWS_TICKS
) {

  const row =
    hitMatchRates[
      String(
        windowTicks
      )
    ];


  console.log(
    `within ${String(windowTicks).padStart(2)} ticks (${row.seconds.toFixed(3)}s): ` +
    `${row.matched}/${row.total} (${formatPercent(row.rate)})`
  );
}


console.log('');

console.log(
  `Nearest-shot offset ticks: ${formatDistribution(
    summary
      .successfulHitAlignment
      .nearestPrecedingShotOffsetTicks
  )}`
);

console.log(
  `Approx shot distance HU:   ${formatDistribution(
    summary
      .successfulHitAlignment
      .approximateShotToImpactDistanceHU
  )}`
);

console.log(
  `Hero agreement:            ${heroAgreements.length}/${heroComparable.length} (${formatPercent(heroAgreementRate)})`
);

console.log('');

console.log(
  'BY HERO'
);

console.log(
  '-------'
);


for (
  const row
  of byHero
) {

  console.log(
    `hero=${String(row.heroId).padEnd(5)} ` +
    `hits=${String(row.hits).padEnd(4)} ` +
    `w32=${formatPercent(row.within32Rate).padEnd(8)} ` +
    `w64=${formatPercent(row.within64Rate).padEnd(8)} ` +
    `medOffset=${formatNumber(row.offsetTicks.median).padEnd(7)} ` +
    `medDist=${formatNumber(row.distanceHU.median).padEnd(9)} ` +
    `medImpliedSpeed=${formatNumber(row.impliedSpeedHUPerSecond.median)}`
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
    name,
    row
  ]
  of Object.entries(
    validationChecks
  )
) {

  console.log(
    `${name.padEnd(46)} ${row.pass} ` +
    `actual=${JSON.stringify(row.actual)} expected=${row.expected}`
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
  `Summary:\n${outputSummaryPath}`
);

console.log('');

console.log(
  `Shots:\n${outputShotsPath}`
);

console.log('');

console.log(
  `Matches:\n${outputMatchesPath}`
);

console.log('');

console.log(
  `Markdown:\n${outputMarkdownPath}`
);

console.log('');


// ============================================================
// POSITIVE ANCHOR NORMALIZATION
// ============================================================

function normalizePositiveAnchor(
  row
) {

  const hitTick =
    firstFinite(
      [
        row
          ?.observedSuccessfulInteraction
          ?.hitTick,

        row?.hitTick
      ]
    );


  const playerName =
    row
      ?.observedSuccessfulInteraction
      ?.attackerPlayerName
    ??
    row?.playerName
    ??
    null;


  const heroId =
    firstFinite(
      [
        row
          ?.observedSuccessfulInteraction
          ?.attackerHeroId,

        row?.heroId
      ]
    );


  const orbPosition =
    normalizePosition(
      row
        ?.orbState
        ?.position
      ??
      row?.orbPosition
    );


  if (
    hitTick ===
    null
    ||
    !playerName
  ) {

    return null;
  }


  return {
    anchorId:
      row.anchorId
      ??
      null,

    eventId:
      row
        ?.event
        ?.eventId
      ??
      row.eventId
      ??
      null,

    hitTick,

    playerName,

    heroId,

    relation:
      row
        ?.observedSuccessfulInteraction
        ?.relation
      ??
      null,

    orbPosition
  };
}


// ============================================================
// WEAPON STATE
// ============================================================

function isPrimaryWeaponCandidate(
  entity,
  className
) {

  if (
    /PrimaryWeapon/i.test(
      className
      ??
      ''
    )
  ) {

    return true;
  }


  return (
    hasField(
      entity,
      'm_nShotNumber'
    )
    &&
    hasField(
      entity,
      'm_flLastAttackTime'
    )
    &&
    hasField(
      entity,
      'm_iClip'
    )
  );
}


function readWeaponState(
  entity
) {

  return {
    subclassId:
      finite(
        safeGetField(
          entity,
          'm_nSubclassID'
        )
      ),

    clip:
      finite(
        safeGetField(
          entity,
          'm_iClip'
        )
      ),

    bonusClip:
      finite(
        safeGetField(
          entity,
          'm_iBonusClip'
        )
      ),

    ammoFraction:
      finite(
        safeGetField(
          entity,
          'm_flAmmoFrac'
        )
      ),

    inReload:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bInReload'
        )
      ),

    shotNumber:
      finite(
        safeGetField(
          entity,
          'm_nShotNumber'
        )
      ),

    continuousShots:
      finite(
        safeGetField(
          entity,
          'm_nNumContinuousShots'
        )
      ),

    burstShotsRemaining:
      finite(
        safeGetField(
          entity,
          'm_nBurstShotsRemaining'
        )
      ),

    lastAttackTime:
      finite(
        safeGetField(
          entity,
          'm_flLastAttackTime'
        )
      ),

    nextPrimaryAttack:
      finite(
        safeGetField(
          entity,
          'm_flNextPrimaryAttack'
        )
      ),

    nextAttackDelayStart:
      finite(
        safeGetField(
          entity,
          'm_flNextAttackDelayStartTime'
        )
      ),

    nextAttackDelayEnd:
      finite(
        safeGetField(
          entity,
          'm_flNextAttackDelayEndTime'
        )
      ),

    reloadAvailableTime:
      finite(
        safeGetField(
          entity,
          'm_flReloadAvailableTime'
        )
      ),

    lastReloadStartTime:
      finite(
        safeGetField(
          entity,
          'm_flLastReloadStartTime'
        )
      ),

    reloadQueuedStartTime:
      finite(
        safeGetField(
          entity,
          'm_reloadQueuedStartTime'
        )
      ),

    firedRecently:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bFiredRecently'
        )
      ),

    activeFireMode:
      finite(
        safeGetField(
          entity,
          'm_eActiveFireMode'
        )
      )
  };
}


function compareWeaponState(
  previous,
  current
) {

  if (
    !previous
  ) {

    return {
      shotNumberDelta:
        0,

      lastAttackTimeAdvanced:
        false,

      clipDelta:
        0,

      firedRecentlyRise:
        false,

      actualDischargeSignal:
        false
    };
  }


  const shotNumberDelta =
    Number.isFinite(
      previous.shotNumber
    )
    &&
    Number.isFinite(
      current.shotNumber
    )
      ? current.shotNumber -
        previous.shotNumber
      : 0;


  const lastAttackTimeAdvanced =
    Number.isFinite(
      previous.lastAttackTime
    )
    &&
    Number.isFinite(
      current.lastAttackTime
    )
    &&
    current.lastAttackTime >
    previous.lastAttackTime +
    1e-6;


  const clipDelta =
    Number.isFinite(
      previous.clip
    )
    &&
    Number.isFinite(
      current.clip
    )
      ? current.clip -
        previous.clip
      : 0;


  const firedRecentlyRise =
    previous.firedRecently ===
    false
    &&
    current.firedRecently ===
    true;


  return {
    shotNumberDelta,

    lastAttackTimeAdvanced,

    clipDelta,

    firedRecentlyRise,

    actualDischargeSignal:
      shotNumberDelta >
      0
      ||
      lastAttackTimeAdvanced
  };
}


function classifyShotSignalConfidence(
  signals
) {

  if (
    signals.shotNumberDelta >
    0
    &&
    signals.lastAttackTimeAdvanced
  ) {

    return 'HIGH';
  }


  if (
    signals.shotNumberDelta >
    0
  ) {

    return 'HIGH';
  }


  if (
    signals.lastAttackTimeAdvanced
    &&
    signals.clipDelta <
    0
  ) {

    return 'HIGH';
  }


  if (
    signals.lastAttackTimeAdvanced
  ) {

    return 'MODERATE';
  }


  return 'LOW';
}


function compactPriorWeaponState(
  row
) {

  return {
    clip:
      row.clip,

    ammoFraction:
      row.ammoFraction,

    inReload:
      row.inReload,

    shotNumber:
      row.shotNumber,

    lastAttackTime:
      row.lastAttackTime,

    nextPrimaryAttack:
      row.nextPrimaryAttack,

    firedRecently:
      row.firedRecently
  };
}


// ============================================================
// PLAYER RESOLUTION
// ============================================================

function resolveWeaponPlayer({
  demo,
  weaponEntity,
  playerData
}) {

  const ownerHandle =
    firstFinite(
      [
        safeGetField(
          weaponEntity,
          'm_hOwnerEntity'
        ),

        safeGetField(
          weaponEntity,
          'm_hOwner'
        )
      ]
    );


  if (
    ownerHandle ===
    null
  ) {

    return null;
  }


  let ownerEntity =
    resolveHandle(
      demo,
      ownerHandle
    );


  for (
    let depth =
      0;

    depth <
      3
      &&
      ownerEntity;

    depth++
  ) {

    const identity =
      resolveIdentityFromEntity({
        demo,
        entity:
          ownerEntity,
        playerData
      });


    if (
      identity
    ) {

      return identity;
    }


    const nextHandle =
      firstFinite(
        [
          safeGetField(
            ownerEntity,
            'm_hOwnerEntity'
          ),

          safeGetField(
            ownerEntity,
            'm_hOwner'
          )
        ]
      );


    if (
      nextHandle ===
      null
    ) {

      break;
    }


    ownerEntity =
      resolveHandle(
        demo,
        nextHandle
      );
  }


  return null;
}


function resolveIdentityFromEntity({
  demo,
  entity,
  playerData
}) {

  const entityIndex =
    getEntityIndex(
      entity
    );


  if (
    entityIndex !==
    null
  ) {

    const byPawn =
      playerData.playerByPawnIndex.get(
        entityIndex
      );


    if (
      byPawn
    ) {

      return byPawn;
    }


    const byController =
      playerData.playerByControllerIndex.get(
        entityIndex
      );


    if (
      byController
    ) {

      return byController;
    }
  }


  const className =
    getEntityClassName(
      entity
    );


  if (
    className ===
    'CCitadelPlayerPawn'
  ) {

    const controllerHandle =
      firstFinite(
        [
          safeGetField(
            entity,
            'm_hController'
          ),

          safeGetField(
            entity,
            'm_hDefaultController'
          )
        ]
      );


    const controller =
      controllerHandle ===
      null
        ? null
        : resolveHandle(
            demo,
            controllerHandle
          );


    if (
      controller
    ) {

      const controllerIndex =
        getEntityIndex(
          controller
        );


      const known =
        controllerIndex ===
        null
          ? null
          : playerData
              .playerByControllerIndex
              .get(
                controllerIndex
              );


      if (
        known
      ) {

        return known;
      }


      const playerName =
        scalarString(
          safeGetField(
            controller,
            'm_iszPlayerName'
          )
        );


      if (
        playerName
      ) {

        return {
          playerName,

          team:
            finite(
              safeGetField(
                controller,
                'm_iTeamNum'
              )
            ),

          heroId:
            firstFinite(
              [
                safeGetField(
                  controller,
                  'm_nHeroID'
                ),

                safeGetField(
                  controller,
                  'm_nHeroId'
                ),

                safeGetField(
                  controller,
                  'm_iHeroID'
                )
              ]
            ),

          pawnEntityIndex:
            entityIndex,

          controllerEntityIndex:
            controllerIndex
        };
      }
    }
  }


  return null;
}


function resolveHandle(
  demo,
  handle
) {

  try {

    return demo.getEntityByHandle(
      handle
    )
    ??
    null;

  } catch {

    return null;
  }
}


// ============================================================
// SHOT MATCHING
// ============================================================

function collectPrecedingShots({
  shots,
  hitTick,
  maximumWindowTicks
}) {

  if (
    shots.length ===
    0
  ) {

    return [];
  }


  const startTick =
    hitTick -
    maximumWindowTicks;


  const start =
    lowerBoundShotTick(
      shots,
      startTick
    );


  const result =
    [];


  for (
    let index =
      start;

    index <
      shots.length
      &&
      shots[
        index
      ].tick <=
      hitTick;

    index++
  ) {

    result.push(
      shots[
        index
      ]
    );
  }


  return result;
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


function compactShotCandidate(
  shot,
  hitTick
) {

  return {
    tick:
      shot.tick,

    offsetTicks:
      hitTick -
      shot.tick,

    offsetSeconds:
      (
        hitTick -
        shot.tick
      ) /
      TICK_RATE,

    weaponEntityIndex:
      shot.weaponEntityIndex,

    weaponClass:
      shot.weaponClass,

    weaponSubclassId:
      shot.weaponSubclassId,

    heroId:
      shot
        ?.player
        ?.heroId
      ??
      null,

    signalConfidence:
      shot
        ?.signal
        ?.confidence
      ??
      null,

    shotNumberDelta:
      shot
        ?.signal
        ?.shotNumberDelta
      ??
      null,

    clip:
      shot
        ?.state
        ?.clip
      ??
      null,

    inReload:
      shot
        ?.state
        ?.inReload
      ??
      null,

    nextPrimaryAttack:
      shot
        ?.state
        ?.nextPrimaryAttack
      ??
      null
  };
}


// ============================================================
// HERO / PLAYER SUMMARY
// ============================================================

function summarizeByHero(
  rows
) {

  const groups =
    new Map();


  for (
    const row
    of rows
  ) {

    const heroId =
      row
        ?.hit
        ?.heroId;


    const key =
      Number.isFinite(
        heroId
      )
        ? String(
            heroId
          )
        : 'UNKNOWN';


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
        row
      );
  }


  return [
    ...groups.entries()
  ]
    .map(
      ([
        key,
        heroRows
      ]) => {

        const matched =
          heroRows.filter(
            row =>
              row.nearestPrecedingShot
          );


        const within32 =
          heroRows.filter(
            row =>
              row
                ?.interpretation
                ?.matchWithin32 ===
              true
          );


        const within64 =
          heroRows.filter(
            row =>
              row
                ?.interpretation
                ?.matchWithin64 ===
              true
          );


        return {
          heroId:
            key ===
            'UNKNOWN'
              ? null
              : Number(
                  key
                ),

          hits:
            heroRows.length,

          matched:
            matched.length,

          within32:
            within32.length,

          within32Rate:
            rate(
              within32.length,
              heroRows.length
            ),

          within64:
            within64.length,

          within64Rate:
            rate(
              within64.length,
              heroRows.length
            ),

          offsetTicks:
            summarizeNumbers(
              matched.map(
                row =>
                  row
                    .nearestPrecedingShot
                    .offsetTicks
              )
            ),

          distanceHU:
            summarizeNumbers(
              matched.map(
                row =>
                  row
                    .nearestPrecedingShot
                    .approximateShotToImpactDistanceHU
              )
            ),

          impliedSpeedHUPerSecond:
            summarizeNumbers(
              matched.map(
                row =>
                  row
                    .nearestPrecedingShot
                    .impliedSpeedHUPerSecond
              )
            )
        };
      }
    )
    .sort(
      (
        a,
        b
      ) =>
        b.hits -
        a.hits
    );
}


function summarizeShotsByPlayer(
  shots,
  hitAnchors
) {

  const playerNames =
    new Set();


  for (
    const shot
    of shots
  ) {

    if (
      shot?.player?.playerName
    ) {

      playerNames.add(
        shot.player.playerName
      );
    }
  }


  for (
    const anchor
    of hitAnchors
  ) {

    playerNames.add(
      anchor.playerName
    );
  }


  return [
    ...playerNames
  ]
    .sort()
    .map(
      playerName => {

        const playerShots =
          shots.filter(
            row =>
              row
                ?.player
                ?.playerName ===
              playerName
          );


        const playerHits =
          hitAnchors.filter(
            row =>
              row.playerName ===
              playerName
          );


        const identity =
          playerShots[0]?.player
          ??
          null;


        return {
          playerName,

          heroId:
            identity?.heroId
            ??
            playerHits[0]?.heroId
            ??
            null,

          shotEvents:
            playerShots.length,

          shotUnits:
            sum(
              playerShots.map(
                row =>
                  row
                    ?.signal
                    ?.shotUnits
              )
            ),

          successfulSoulHits:
            playerHits.length
        };
      }
    );
}


// ============================================================
// PLAYER STATE LOADER
// ============================================================

async function loadPlayerData(
  path
) {

  const playerByName =
    new Map();


  const playerByPawnIndex =
    new Map();


  const playerByControllerIndex =
    new Map();


  const timelineByPlayer =
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


    if (
      !playerName
    ) {

      continue;
    }


    const controllerEntityIndex =
      finite(
        row
          ?.controller
          ?.entityIndex
      );


    const pawnEntityIndex =
      finite(
        row
          ?.pawn
          ?.entityIndex
      );


    const existing =
      playerByName.get(
        playerName
      )
      ??
      {};


    const identity =
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

        controllerEntityIndex:
          controllerEntityIndex
          ??
          existing.controllerEntityIndex
          ??
          null,

        pawnEntityIndex:
          pawnEntityIndex
          ??
          existing.pawnEntityIndex
          ??
          null
      };


    playerByName.set(
      playerName,
      identity
    );


    if (
      controllerEntityIndex !==
      null
    ) {

      playerByControllerIndex.set(
        controllerEntityIndex,
        identity
      );
    }


    if (
      pawnEntityIndex !==
      null
    ) {

      playerByPawnIndex.set(
        pawnEntityIndex,
        identity
      );
    }


    const tick =
      finite(
        row.demoTick
      );


    if (
      tick ===
      null
    ) {

      continue;
    }


    if (
      !timelineByPlayer.has(
        playerName
      )
    ) {

      timelineByPlayer.set(
        playerName,
        []
      );
    }


    timelineByPlayer
      .get(
        playerName
      )
      .push(
        {
          tick,

          alive:
            row
              ?.controller
              ?.alive ===
            true,

          movementValid:
            row
              ?.pawn
              ?.positionValidForMovement ===
            true,

          position:
            normalizePosition(
              row
                ?.pawn
                ?.positionWorld
            )
        }
      );
  }


  for (
    const rows
    of timelineByPlayer.values()
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


  return {
    playerByName,
    playerByPawnIndex,
    playerByControllerIndex,
    timelineByPlayer
  };
}


function reconstructPlayerStateAtTick({
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
      tick,

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
        tick,

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


  const candidates =
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


  const nearest =
    candidates[0]
    ??
    null;


  if (
    !nearest
  ) {

    return null;
  }


  return {
    tick,

    method:
      'NEAREST_4HZ_SAMPLE',

    position:
      nearest.position
  };
}


function lowerBoundTimelineTick(
  rows,
  target
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
      target
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
// ENTITY HELPERS
// ============================================================

function safeGetChanges(
  event
) {

  try {

    return typeof event?.getChanges ===
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
    raw ===
    null
    ||
    raw ===
    undefined
  ) {

    return [];
  }


  if (
    raw instanceof
    Map
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

    return typeof entity?.getField ===
      'function'
      ? entity.getField(
          fieldName
        )
      : undefined;

  } catch {

    return undefined;
  }
}


function hasField(
  entity,
  fieldName
) {

  try {

    if (
      typeof entity?.hasField ===
      'function'
    ) {

      return entity.hasField(
        fieldName
      );
    }


    return safeGetField(
      entity,
      fieldName
    ) !==
    undefined;

  } catch {

    return false;
  }
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

    return typeof entity?.getIndex ===
      'function'
      ? finite(
          entity.getIndex()
        )
      : null;

  } catch {

    return null;
  }
}


function getEntityClassName(
  entity
) {

  return entity
    ?.class
    ?.name
    ??
    entity
      ?.className
    ??
    null;
}


function isInterestingWeaponField(
  name
) {

  return [
    'm_iClip',
    'm_iBonusClip',
    'm_bInReload',
    'm_nShotNumber',
    'm_nNumContinuousShots',
    'm_nBurstShotsRemaining',
    'm_flLastAttackTime',
    'm_flNextPrimaryAttack',
    'm_flNextAttackDelayStartTime',
    'm_flNextAttackDelayEndTime',
    'm_flReloadAvailableTime',
    'm_flLastReloadStartTime',
    'm_reloadQueuedStartTime',
    'm_flAmmoFrac',
    'm_bFiredRecently',
    'm_eActiveFireMode'
  ].includes(
    name
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


function booleanOrNull(
  value
) {

  if (
    value ===
    true
    ||
    value ===
    false
  ) {

    return value;
  }


  if (
    value ===
    1
    ||
    value ===
    '1'
  ) {

    return true;
  }


  if (
    value ===
    0
    ||
    value ===
    '0'
  ) {

    return false;
  }


  return null;
}


function scalarString(
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
  ) {

    return value;
  }


  return String(
    value
  );
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
    firstFinite(
      [
        value.x,
        value.X,
        value[0]
      ]
    );


  const y =
    firstFinite(
      [
        value.y,
        value.Y,
        value[1]
      ]
    );


  const z =
    firstFinite(
      [
        value.z,
        value.Z,
        value[2]
      ]
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
    dx
    +
    dy *
    dy
    +
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
          2
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
    '# Primary Weapon Shot Telemetry Validation'
  );


  lines.push('');


  lines.push(
    `Replay: **${summary.replay}**`
  );


  lines.push(
    `Status: **${summary.status}**`
  );


  lines.push('');


  lines.push(
    '## Purpose'
  );


  lines.push('');


  lines.push(
    'Validate an independent primary-weapon discharge signal against known successful CItemXP Damage impacts.'
  );


  lines.push('');


  lines.push(
    '## Weapon telemetry'
  );


  lines.push('');


  lines.push(
    `- Unique weapon entities: ${summary.weaponTelemetry.uniqueWeaponEntities}`
  );


  lines.push(
    `- Player-linked weapon entities: ${summary.weaponTelemetry.playerLinkedWeaponEntities}`
  );


  lines.push(
    `- Observed discharge events: ${summary.weaponTelemetry.totalDischargeEvents}`
  );


  lines.push(
    `- Player-linked discharge events: ${summary.weaponTelemetry.playerLinkedDischargeEvents}`
  );


  lines.push('');


  lines.push(
    '## Successful-hit alignment'
  );


  lines.push('');


  for (
    const window
    of Object.values(
      summary
        .successfulHitAlignment
        .hitMatchRates
    )
  ) {

    lines.push(
      `- Within ${window.windowTicks} ticks (${window.seconds.toFixed(3)} s): ${window.matched}/${window.total} (${formatPercent(window.rate)})`
    );
  }


  lines.push('');


  lines.push(
    `- Hero agreement: ${summary.successfulHitAlignment.heroAgreement}/${summary.successfulHitAlignment.heroComparableMatches} (${formatPercent(summary.successfulHitAlignment.heroAgreementRate)})`
  );


  lines.push('');


  lines.push(
    '## Semantic limits'
  );


  lines.push('');


  lines.push(
    '- Weapon discharge is an observed action/execution signal, not direct target attribution.'
  );


  lines.push(
    '- Nearest preceding shot remains candidate linkage only.'
  );


  lines.push(
    '- Exploratory implied speed is not yet a projectile-speed constant.'
  );


  lines.push(
    '- Trigger-input attempts while the gun cannot fire are not measured here.'
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