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
  'FLYING_SOUL_OPPORTUNITY_EXISTENCE_V01';


// ============================================================
// PURPOSE
//
// This is the FIRST behavioral-opportunity construction layer.
//
// IMPORTANT:
//
// This script does NOT classify:
//
//   - line of sight
//   - true shootability
//   - aimability
//   - whether the player "should" have acted
//   - failure to act
//   - success/failure
//
// It establishes only:
//
//   1. Did a contestable Trooper flying soul actually exist?
//   2. What role did each player mechanically occupy?
//        SAME ORB TEAM     -> DENY candidate
//        OPPOSING ORB TEAM -> SECURE candidate
//   3. Was the player observed alive while that soul existed?
//
// Player distance to the ORB SPAWN ANCHOR is included only as
// descriptive geometry.
//
// It is NOT interpreted as exact accessibility because:
//
//   - the orb moves
//   - player state is sampled at 4 Hz
//   - line of sight is not yet modeled
//   - exact attackable timing is not yet reconstructed here
//
// This distinction is foundational:
//
//   STIMULUS EXISTS
//        !=
//   ACCESSIBLE OPPORTUNITY
//        !=
//   RESPONSE ATTEMPT
//        !=
//   SUCCESSFUL OUTCOME
//
// ============================================================


// ============================================================
// FROZEN / OPERATIONAL SOURCE SEMANTICS
// ============================================================

// Validated Trooper flying-soul CItemXP subclass.
//
// Still operational rather than engine-canonical.
const TROOPER_FLYING_CITEMXP_SUBCLASS =
  '494398941';


// ------------------------------------------------------------
// Trooper death -> CItemXP source-link envelope.
//
// Preserve the previously used source relationship.
//
// We do NOT fit a new source threshold here.
// ------------------------------------------------------------

const SOURCE_MIN_TICK_OFFSET =
  -1;


const SOURCE_MAX_TICK_OFFSET =
  4;


const SOURCE_MAX_DISTANCE_3D_HU =
  250;


// ============================================================
// PLAYER STATE
// ============================================================

const EXPECTED_PLAYERS_PER_REPLAY =
  12;


const PLAYER_STATE_SAMPLE_TICKS =
  16;


const TICK_RATE =
  64;


// ============================================================
// PATHS
// ============================================================

const MANIFEST_PATH =
  resolve(
    'output',
    'cross_replay',
    'replication_manifest_v01.json'
  );


const CLOSURE_PATH =
  resolve(
    'output',
    'cross_replay',
    'trooper_reward_source_semantics_closure_v01.json'
  );


const OUTPUT_JSON_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_opportunity_existence_batch_v01.json'
  );


const OUTPUT_MARKDOWN_PATH =
  resolve(
    'output',
    'cross_replay',
    'flying_soul_opportunity_existence_batch_v01.md'
  );


// ============================================================
// INPUT VALIDATION
// ============================================================

for (
  const path
  of [
    MANIFEST_PATH,
    CLOSURE_PATH
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


const closure =
  JSON.parse(
    readFileSync(
      CLOSURE_PATH,
      'utf8'
    )
  );


if (
  closure?.status !==
  'TROOPER_REWARD_SOURCE_SEMANTICS_OPERATIONALLY_CLOSED'
) {

  throw new Error(
    `Reward-source semantics are not closed.\nStatus: ${closure?.status}`
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
  'FLYING-SOUL OPPORTUNITY EXISTENCE LAYER V0.1'
);

console.log(
  '========================================================'
);


console.log('');

console.log(
  'BEHAVIORAL CONTRACT'
);

console.log(
  '-------------------'
);


console.log(
  'STIMULUS EXISTENCE -> ROLE -> ALIVE STATE'
);


console.log(
  'Accessibility / response / outcome are NOT inferred yet.'
);


console.log('');

console.log(
  `Independent replay units: ${cohort.length}`
);


console.log(
  'Raw .dem parsing:          NONE'
);


console.log(
  'Player-state sampling:     16 ticks / 0.25 sec'
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

const passingReplays =
  replayResults.filter(
    row =>
      row.validation.pass
  );


const batchPass =
  passingReplays.length ===
  replayResults.length;


// ============================================================
// GLOBAL DISTRIBUTIONS
// ============================================================

const distributions =
  {

    sourceLinkedOrbCount:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .sourceLink
              .strictLinks
        )
      ),


    sourceLinkDistance3D:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .sourceLink
              .strictDistances3D
        )
      ),


    sourceLinkTickDelta:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .sourceLink
              .strictTickDeltas
        )
      ),


    orbExistenceDurationSeconds:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .events
              .durationSecondsValues
        )
      ),


    candidateAliveObservedRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .candidates
              .aliveObservedRate
        )
      ),


    secureAliveObservedRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .candidates
              .secureAliveObservedRate
        )
      ),


    denyAliveObservedRate:
      summarizeNumbers(
        replayResults.map(
          row =>
            row
              .candidates
              .denyAliveObservedRate
        )
      ),


    spawnAnchorMinimumXYAlive:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .candidateGeometry
              .aliveMinXYValues
        )
      ),


    spawnAnchorMinimum3DAlive:
      summarizeNumbers(
        replayResults.flatMap(
          row =>
            row
              .candidateGeometry
              .aliveMin3DValues
        )
      )
  };


// ============================================================
// FINAL STATUS
// ============================================================

const status =
  batchPass
    ? 'FLYING_SOUL_OPPORTUNITY_EXISTENCE_BASE_READY'
    : 'FLYING_SOUL_OPPORTUNITY_EXISTENCE_BASE_REQUIRES_DIAGNOSIS';


// ============================================================
// INTERPRETATION
// ============================================================

const interpretation =
  {

    status,

    established:
      [

        'Observed Trooper flying-soul stimulus existence.',

        'Per-player secure-versus-deny mechanical role.',

        'Observed player alive-state overlap with the flying-soul existence interval.',

        'Descriptive player proximity to the orb spawn anchor.'
      ],

    notEstablished:
      [

        'Exact attackable opportunity.',

        'Line of sight.',

        'Current orb-to-player distance throughout the moving orb trajectory.',

        'Whether the player was aiming at or attending to the orb.',

        'Whether a response was attempted.',

        'Whether a non-response should be interpreted as ignoring the orb.'
      ],

    nextQuestion:
      batchPass
        ? 'During the exact attackable interval, when was each living player spatially and visually capable of interacting with the moving orb?'
        : 'Resolve structural failures before adding accessibility semantics.',

    nextStage:
      batchPass
        ? 'FLYING_SOUL_ACCESSIBILITY_AND_ACTIONABILITY'
        : 'STRUCTURAL_DIAGNOSIS'
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


    authority:
      {

        rewardSourceClosure:
          closure.status,

        rewardPaths:
          closure.operationalModel,

        importantConsequence:
          'Only observed flying CItemXP episodes generate flying-soul secure/deny candidate rows. Melee-finished Troopers with no flying orb therefore create no artificial deny opportunity.'
      },


    methodology:
      {

        replicationUnit:
          'REPLAY',

        sourceEvent:
          'Mutually unique Trooper death -> subclass 494398941 CItemXP source link.',

        sourceTickEnvelope:
          {

            minimum:
              SOURCE_MIN_TICK_OFFSET,

            maximum:
              SOURCE_MAX_TICK_OFFSET
          },

        sourceDistance3DMaximumHU:
          SOURCE_MAX_DISTANCE_3D_HU,

        playerStateSampling:
          {

            ticks:
              PLAYER_STATE_SAMPLE_TICKS,

            seconds:
              PLAYER_STATE_SAMPLE_TICKS /
              TICK_RATE
          },

        roleSemantics:
          {

            sameOrbTeam:
              'DENY_CANDIDATE',

            opposingOrbTeam:
              'SECURE_CANDIDATE'
          },

        existenceInterval:
          'CItemXP logical startTick -> first observed LEAVE/DELETE tick.',

        geometry:
          'Distance is measured to the fixed orb spawn anchor only. It is explicitly not an accessibility metric.'
      },


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
  'FLYING-SOUL OPPORTUNITY EXISTENCE SUMMARY'
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

    `orbs=${String(
      row.sourceLink.strictLinks
    ).padEnd(5)} ` +

    `candidates=${String(
      row.candidates.total
    ).padEnd(7)} ` +

    `alive=${formatPercent(
      row.candidates.aliveObservedRate
    ).padEnd(8)} ` +

    `pass=${row.validation.pass}`
  );
}


console.log('');

console.log(
  'OPPORTUNITY-TIER COUNTS'
);

console.log(
  '-----------------------'
);


const globalTierCounts =
  mergeCountObjects(
    replayResults.map(
      row =>
        row
          .candidates
          .tierCounts
    )
  );


for (
  const [
    key,
    value
  ]
  of Object.entries(
    globalTierCounts
  )
) {

  console.log(
    `${key.padEnd(52)} ${value}`
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
  `Source-linked orbs:       ${formatDistribution(
    distributions.sourceLinkedOrbCount
  )}`
);


console.log(
  `Orb duration seconds:     ${formatDistribution(
    distributions.orbExistenceDurationSeconds
  )}`
);


console.log(
  `Alive candidate rate:     ${formatDistribution(
    distributions.candidateAliveObservedRate
  )}`
);


console.log(
  `Secure alive rate:        ${formatDistribution(
    distributions.secureAliveObservedRate
  )}`
);


console.log(
  `Deny alive rate:          ${formatDistribution(
    distributions.denyAliveObservedRate
  )}`
);


console.log(
  `Alive min spawn XY:       ${formatDistribution(
    distributions.spawnAnchorMinimumXYAlive
  )}`
);


console.log(
  `Alive min spawn 3D:       ${formatDistribution(
    distributions.spawnAnchorMinimum3DAlive
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
  'NEXT QUESTION'
);

console.log(
  '-------------'
);


console.log(
  interpretation.nextQuestion
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


  const playerStatePath =
    resolve(
      outputDirectory,
      'player_state.jsonl'
    );


  const playerSummaryPath =
    resolve(
      outputDirectory,
      'player_state_summary.json'
    );


  const candidateOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_opportunity_existence_v01.jsonl'
    );


  const eventOutputPath =
    resolve(
      outputDirectory,
      'flying_soul_opportunity_events_v01.jsonl'
    );


  const replaySummaryPath =
    resolve(
      outputDirectory,
      'flying_soul_opportunity_existence_summary_v01.json'
    );


  for (
    const path
    of [
      deathsPath,
      episodesPath,
      playerStatePath,
      playerSummaryPath
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
  // LOAD EVENT INPUTS
  // ----------------------------------------------------------

  const deaths =
    await loadJsonl(
      deathsPath
    );


  const episodes =
    await loadJsonl(
      episodesPath
    );


  const playerSummary =
    JSON.parse(
      readFileSync(
        playerSummaryPath,
        'utf8'
      )
    );


  // ----------------------------------------------------------
  // BUILD PLAYER ROSTER
  // ----------------------------------------------------------

  const expectedNames =
    Array.isArray(
      playerSummary?.playersSeen
    )
      ? playerSummary.playersSeen
      : [];


  const roster =
    await loadPlayerRoster({

      playerStatePath,

      expectedNames
    });


  // ----------------------------------------------------------
  // SOURCE-LINK OBSERVED TROOPER FLYING ORBS
  // ----------------------------------------------------------

  const sourceLink =
    buildTrooperOrbSourceLinks(
      deaths,
      episodes
    );


  const events =
    sourceLink.strictLinks
      .map(
        link =>
          buildOpportunityEvent(
            replayName,
            link
          )
      )
      .filter(
        Boolean
      )
      .sort(
        (
          a,
          b
        ) =>
          a.startTick -
          b.startTick
          ||
          a.orbEntityIndex -
          b.orbEntityIndex
      );


  // ----------------------------------------------------------
  // INITIALIZE PER-PLAYER CANDIDATES
  // ----------------------------------------------------------

  const candidateMap =
    new Map();


  for (
    const event
    of events
  ) {

    for (
      const player
      of roster.players
    ) {

      const role =
        classifyRole(
          player.team,
          event.orbTeam
        );


      const candidate =
        {

          schemaVersion:
            1,

          canonical:
            false,

          replay:
            replayName,

          candidateId:
            `${event.eventId}|${player.playerName}`,

          eventId:
            event.eventId,


          source:
            {

              type:
                'TROOPER_DEATH',

              deathId:
                event.sourceDeathId,

              deathTick:
                event.sourceDeathTick,

              trooperEntityIndex:
                event.sourceTrooperEntityIndex,

              trooperTeam:
                event.sourceTrooperTeam,

              sourceDistance3D:
                event.sourceDistance3D,

              sourceTickDelta:
                event.sourceTickDelta
            },


          stimulus:
            {

              type:
                'TROOPER_FLYING_SOUL',

              exists:
                true,

              evidence:
                'OBSERVED_SOURCE_LINKED_CITEMXP_EPISODE',

              orbEpisodeId:
                event.orbEpisodeId,

              orbEntityIndex:
                event.orbEntityIndex,

              orbSubclassId:
                event.orbSubclassId,

              orbTeam:
                event.orbTeam,

              spawnPosition:
                event.spawnPosition,

              existenceStartTick:
                event.startTick,

              existenceEndTick:
                event.endTick,

              existenceDurationTicks:
                event.durationTicks,

              existenceDurationSeconds:
                event.durationSeconds
            },


          player:
            {

              playerName:
                player.playerName,

              steamId:
                player.steamId,

              team:
                player.team,

              heroId:
                player.heroId,

              controllerEntityIndex:
                player.controllerEntityIndex,

              pawnEntityIndex:
                player.pawnEntityIndex
            },


          role:
            {

              type:
                role,

              mechanicallyResolved:
                role !==
                'ROLE_UNRESOLVED',

              rule:
                role ===
                'DENY_CANDIDATE'
                  ? 'PLAYER_TEAM_EQUALS_ORB_TEAM'
                  : role ===
                      'SECURE_CANDIDATE'
                    ? 'PLAYER_TEAM_OPPOSES_ORB_TEAM'
                    : 'TEAM_RELATION_UNRESOLVED'
            },


          observation:
            {

              sampleCountDuringExistence:
                0,

              aliveSampleCount:
                0,

              validPositionSampleCount:
                0,

              firstObservedSample:
                null,

              firstAliveSample:
                null,

              lastAliveSample:
                null
            },


          spawnAnchorGeometry:
            {

              semanticStatus:
                'DESCRIPTIVE_ONLY_NOT_ACCESSIBILITY',

              minimumXY:
                null,

              minimum3D:
                null,

              minimumTick:
                null,

              firstValidXY:
                null,

              firstValid3D:
                null,

              closestSample:
                null
            }
        };


      candidateMap.set(
        candidate.candidateId,
        candidate
      );
    }
  }


  // ----------------------------------------------------------
  // STREAM PLAYER STATE AGAINST OBSERVED ORB EXISTENCE
  // ----------------------------------------------------------

  const stateProcessing =
    await processPlayerState({

      playerStatePath,

      events,

      candidateMap
    });


  // ----------------------------------------------------------
  // FINALIZE CANDIDATES
  // ----------------------------------------------------------

  const candidates =
    [
      ...candidateMap.values()
    ]
      .map(
        finalizeCandidate
      )
      .sort(
        (
          a,
          b
        ) =>
          a
            .stimulus
            .existenceStartTick
          -
          b
            .stimulus
            .existenceStartTick
          ||
          a.player.playerName.localeCompare(
            b.player.playerName
          )
      );


  // ----------------------------------------------------------
  // SUMMARIZE CANDIDATES
  // ----------------------------------------------------------

  const secureCandidates =
    candidates.filter(
      row =>
        row.role.type ===
        'SECURE_CANDIDATE'
    );


  const denyCandidates =
    candidates.filter(
      row =>
        row.role.type ===
        'DENY_CANDIDATE'
    );


  const unresolvedRoles =
    candidates.filter(
      row =>
        row.role.type ===
        'ROLE_UNRESOLVED'
    );


  const aliveCandidates =
    candidates.filter(
      row =>
        row
          .eligibility
          .aliveObservedDuringExistence
    );


  const secureAlive =
    secureCandidates.filter(
      row =>
        row
          .eligibility
          .aliveObservedDuringExistence
    );


  const denyAlive =
    denyCandidates.filter(
      row =>
        row
          .eligibility
          .aliveObservedDuringExistence
    );


  const tierCounts =
    countByObject(
      candidates,
      row =>
        row
          .eligibility
          .tier
    );


  // ----------------------------------------------------------
  // PER-PLAYER SUMMARY
  // ----------------------------------------------------------

  const playerRows =
    roster.players
      .map(
        player => {

          const rows =
            candidates.filter(
              row =>
                row.player.playerName ===
                player.playerName
            );


          const secure =
            rows.filter(
              row =>
                row.role.type ===
                'SECURE_CANDIDATE'
            );


          const deny =
            rows.filter(
              row =>
                row.role.type ===
                'DENY_CANDIDATE'
            );


          const alive =
            rows.filter(
              row =>
                row
                  .eligibility
                  .aliveObservedDuringExistence
            );


          return {

            playerName:
              player.playerName,

            team:
              player.team,

            heroId:
              player.heroId,

            totalStimuli:
              rows.length,

            secureCandidates:
              secure.length,

            denyCandidates:
              deny.length,

            aliveExposureCandidates:
              alive.length,

            aliveExposureRate:
              rate(
                alive.length,
                rows.length
              ),

            aliveSecureCandidates:
              secure.filter(
                row =>
                  row
                    .eligibility
                    .aliveObservedDuringExistence
              ).length,

            aliveDenyCandidates:
              deny.filter(
                row =>
                  row
                    .eligibility
                    .aliveObservedDuringExistence
              ).length,

            aliveSpawnAnchorMinXY:
              summarizeNumbers(
                alive.map(
                  row =>
                    row
                      .spawnAnchorGeometry
                      .minimumXY
                )
              ),

            aliveSpawnAnchorMin3D:
              summarizeNumbers(
                alive.map(
                  row =>
                    row
                      .spawnAnchorGeometry
                      .minimum3D
                )
              )
          };
        }
      );


  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const expectedCandidateCount =
    events.length *
    roster.players.length;


  const teamCounts =
    countByObject(
      roster.players,
      row =>
        `TEAM_${row.team}`
    );


  const checks =
    {

      rosterHasExpectedPlayers:
        {

          actual:
            roster.players.length,

          expected:
            EXPECTED_PLAYERS_PER_REPLAY,

          pass:
            roster.players.length ===
            EXPECTED_PLAYERS_PER_REPLAY
        },


      rosterTeamsResolved:
        {

          actual:
            roster.players.filter(
              row =>
                isGameTeam(
                  row.team
                )
            ).length,

          expected:
            roster.players.length,

          pass:
            roster.players.every(
              row =>
                isGameTeam(
                  row.team
                )
            )
        },


      sourceLinkedOrbsExist:
        {

          actual:
            events.length,

          expected:
            '>0',

          pass:
            events.length >
            0
        },


      everyEventHasPositiveDuration:
        {

          actual:
            events.filter(
              row =>
                row.durationTicks >
                0
            ).length,

          expected:
            events.length,

          pass:
            events.every(
              row =>
                row.durationTicks >
                0
            )
        },


      candidateCount:
        {

          actual:
            candidates.length,

          expected:
            expectedCandidateCount,

          pass:
            candidates.length ===
            expectedCandidateCount
        },


      allRolesResolved:
        {

          actual:
            candidates.length -
            unresolvedRoles.length,

          expected:
            candidates.length,

          pass:
            unresolvedRoles.length ===
            0
        },


      secureAndDenyBothPresent:
        {

          actual:
            {

              secure:
                secureCandidates.length,

              deny:
                denyCandidates.length
            },

          expected:
            'both > 0',

          pass:
            secureCandidates.length >
            0
            &&
            denyCandidates.length >
            0
        },


      playerStateRowsProcessed:
        {

          actual:
            stateProcessing.rowsParsed,

          expected:
            '>0',

          pass:
            stateProcessing.rowsParsed >
            0
        },


      playerStateOverlapObserved:
        {

          actual:
            candidates.filter(
              row =>
                row
                  .observation
                  .sampleCountDuringExistence >
                0
            ).length,

          expected:
            '>0',

          pass:
            candidates.some(
              row =>
                row
                  .observation
                  .sampleCountDuringExistence >
                0
            )
        }
    };


  const validationPass =
    Object.values(
      checks
    )
      .every(
        row =>
          row.pass
      );


  // ----------------------------------------------------------
  // REPLAY SUMMARY
  // ----------------------------------------------------------

  const result =
    {

      replay:
        replayName,

      version:
        VERSION,

      canonical:
        false,


      sourceLink:
        {

          economicTrooperDeaths:
            sourceLink.economicTrooperDeaths,

          candidateOrbEpisodes:
            sourceLink.candidateOrbEpisodes,

          candidateEdges:
            sourceLink.candidateEdges,

          ambiguousDeaths:
            sourceLink.ambiguousDeaths,

          ambiguousEpisodes:
            sourceLink.ambiguousEpisodes,

          strictLinks:
            events.length,

          strictLinkRateVsEconomicDeaths:
            rate(
              events.length,
              sourceLink.economicTrooperDeaths
            ),

          note:
            'No-match deaths are not failures because melee-finisher deaths may legitimately produce no flying CItemXP.',

          strictTickDelta:
            summarizeNumbers(
              events.map(
                row =>
                  row.sourceTickDelta
              )
            ),

          strictDistance3D:
            summarizeNumbers(
              events.map(
                row =>
                  row.sourceDistance3D
              )
            ),

          strictTickDeltas:
            events.map(
              row =>
                row.sourceTickDelta
            ),

          strictDistances3D:
            events.map(
              row =>
                row.sourceDistance3D
            )
        },


      roster:
        {

          players:
            roster.players.length,

          expectedPlayers:
            expectedNames.length,

          teamCounts,

          identities:
            roster.players
        },


      events:
        {

          total:
            events.length,

          durationTicks:
            summarizeNumbers(
              events.map(
                row =>
                  row.durationTicks
              )
            ),

          durationSeconds:
            summarizeNumbers(
              events.map(
                row =>
                  row.durationSeconds
              )
            ),

          durationSecondsValues:
            events.map(
              row =>
                row.durationSeconds
            )
        },


      candidates:
        {

          total:
            candidates.length,

          secure:
            secureCandidates.length,

          deny:
            denyCandidates.length,

          unresolvedRole:
            unresolvedRoles.length,

          aliveObserved:
            aliveCandidates.length,

          aliveObservedRate:
            rate(
              aliveCandidates.length,
              candidates.length
            ),

          secureAliveObserved:
            secureAlive.length,

          secureAliveObservedRate:
            rate(
              secureAlive.length,
              secureCandidates.length
            ),

          denyAliveObserved:
            denyAlive.length,

          denyAliveObservedRate:
            rate(
              denyAlive.length,
              denyCandidates.length
            ),

          tierCounts
        },


      candidateGeometry:
        {

          semanticStatus:
            'SPAWN_ANCHOR_PROXIMITY_ONLY',

          aliveMinXY:
            summarizeNumbers(
              aliveCandidates.map(
                row =>
                  row
                    .spawnAnchorGeometry
                    .minimumXY
              )
            ),

          aliveMin3D:
            summarizeNumbers(
              aliveCandidates.map(
                row =>
                  row
                    .spawnAnchorGeometry
                    .minimum3D
              )
            ),

          aliveMinXYValues:
            aliveCandidates
              .map(
                row =>
                  row
                    .spawnAnchorGeometry
                    .minimumXY
              )
              .filter(
                Number.isFinite
              ),

          aliveMin3DValues:
            aliveCandidates
              .map(
                row =>
                  row
                    .spawnAnchorGeometry
                    .minimum3D
              )
              .filter(
                Number.isFinite
              )
        },


      playerStateProcessing:
        stateProcessing,


      players:
        playerRows,


      validation:
        {

          pass:
            validationPass,

          checks
        },


      outputs:
        {

          events:
            eventOutputPath,

          candidates:
            candidateOutputPath,

          summary:
            replaySummaryPath
        }
    };


  // ----------------------------------------------------------
  // WRITE
  // ----------------------------------------------------------

  await writeJsonl(
    eventOutputPath,
    events
  );


  await writeJsonl(
    candidateOutputPath,
    candidates
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
// BUILD TROOPER -> CITEMXP SOURCE LINKS
// ============================================================

function buildTrooperOrbSourceLinks(
  deaths,
  episodes
) {

  const economicDeaths =
    deaths.filter(
      row =>
        row.economicBaseType ===
        true
        &&
        isGameTeam(
          finite(
            row.team
          )
        )
        &&
        Number.isFinite(
          finite(
            row.tick
          )
        )
        &&
        normalizePosition(
          row.position
        )
    );


  const candidateEpisodes =
    episodes.filter(
      row =>
        String(
          row.subclassId
        ) ===
        TROOPER_FLYING_CITEMXP_SUBCLASS
        &&
        isGameTeam(
          finite(
            row.team
          )
        )
        &&
        Number.isFinite(
          finite(
            row.startTick
          )
        )
        &&
        normalizePosition(
          row.startPosition
        )
        &&
        Number.isFinite(
          getEpisodeEndTick(
            row
          )
        )
    );


  const episodesByStartTick =
    groupBy(
      candidateEpisodes,
      row =>
        Number(
          row.startTick
        )
    );


  const candidatesByDeath =
    new Map();


  let candidateEdges =
    0;


  for (
    const death
    of economicDeaths
  ) {

    const deathId =
      makeDeathId(
        death
      );


    const deathTick =
      Number(
        death.tick
      );


    const deathPosition =
      normalizePosition(
        death.position
      );


    const deathTeam =
      Number(
        death.team
      );


    const edges =
      [];


    for (
      let tick =
        deathTick +
        SOURCE_MIN_TICK_OFFSET;

      tick <=
        deathTick +
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

        const episodeTeam =
          finite(
            episode.team
          );


        // ----------------------------------------------------
        // Orb team == dead Trooper team is already an
        // established operational relationship.
        // ----------------------------------------------------

        if (
          episodeTeam !==
          deathTeam
        ) {

          continue;
        }


        const startPosition =
          normalizePosition(
            episode.startPosition
          );


        const distance3d =
          distance3D(
            deathPosition,
            startPosition
          );


        if (
          distance3d >
          SOURCE_MAX_DISTANCE_3D_HU
        ) {

          continue;
        }


        const edge =
          {

            death,

            deathId,

            episode,

            episodeId:
              String(
                episode.episodeId
              ),

            tickDelta:
              Number(
                episode.startTick
              )
              -
              deathTick,

            distanceXY:
              distanceXY(
                deathPosition,
                startPosition
              ),

            distance3D:
              distance3d
          };


        edges.push(
          edge
        );


        candidateEdges++;
      }
    }


    candidatesByDeath.set(
      deathId,
      edges
    );
  }


  // ----------------------------------------------------------
  // REVERSE CANDIDATE SETS
  // ----------------------------------------------------------

  const candidatesByEpisode =
    new Map();


  for (
    const edges
    of candidatesByDeath.values()
  ) {

    for (
      const edge
      of edges
    ) {

      if (
        !candidatesByEpisode.has(
          edge.episodeId
        )
      ) {

        candidatesByEpisode.set(
          edge.episodeId,
          []
        );
      }


      candidatesByEpisode
        .get(
          edge.episodeId
        )
        .push(
          edge
        );
    }
  }


  // ----------------------------------------------------------
  // MUTUALLY UNIQUE PRIMARY LINKS
  // ----------------------------------------------------------

  const strictLinks =
    [];


  for (
    const edges
    of candidatesByDeath.values()
  ) {

    if (
      edges.length !==
      1
    ) {

      continue;
    }


    const edge =
      edges[0];


    const reverse =
      candidatesByEpisode.get(
        edge.episodeId
      )
      ??
      [];


    if (
      reverse.length !==
      1
    ) {

      continue;
    }


    strictLinks.push(
      edge
    );
  }


  return {

    economicTrooperDeaths:
      economicDeaths.length,

    candidateOrbEpisodes:
      candidateEpisodes.length,

    candidateEdges,

    ambiguousDeaths:
      [
        ...candidatesByDeath.values()
      ]
        .filter(
          rows =>
            rows.length >
            1
        ).length,

    ambiguousEpisodes:
      [
        ...candidatesByEpisode.values()
      ]
        .filter(
          rows =>
            rows.length >
            1
        ).length,

    strictLinks
  };
}


// ============================================================
// BUILD OPPORTUNITY EVENT
// ============================================================

function buildOpportunityEvent(
  replayName,
  link
) {

  const death =
    link.death;


  const episode =
    link.episode;


  const startTick =
    finite(
      episode.startTick
    );


  const endTick =
    getEpisodeEndTick(
      episode
    );


  const spawnPosition =
    normalizePosition(
      episode.startPosition
    );


  if (
    startTick ===
      null
    ||
    endTick ===
      null
    ||
    endTick <=
      startTick
    ||
    !spawnPosition
  ) {

    return null;
  }


  const durationTicks =
    endTick -
    startTick;


  return {

    schemaVersion:
      1,

    canonical:
      false,

    replay:
      replayName,

    eventId:
      `FLYING_SOUL|${episode.episodeId}|${death.tick}`,


    sourceDeathId:
      link.deathId,

    sourceDeathTick:
      finite(
        death.tick
      ),

    sourceDeathTimeSeconds:
      finite(
        death.timeSeconds
      ),

    sourceTrooperEntityIndex:
      finite(
        death.entityIndex
      ),

    sourceTrooperTeam:
      finite(
        death.team
      ),

    sourceTrooperBaseType:
      death.baseType
      ??
      null,

    sourceDistanceXY:
      link.distanceXY,

    sourceDistance3D:
      link.distance3D,

    sourceTickDelta:
      link.tickDelta,


    orbEpisodeId:
      String(
        episode.episodeId
      ),

    orbEntityIndex:
      finite(
        episode.entityIndex
      ),

    orbSubclassId:
      String(
        episode.subclassId
      ),

    orbTeam:
      finite(
        episode.team
      ),

    spawnPosition,

    startTick,

    endTick,

    durationTicks,

    durationSeconds:
      durationTicks /
      TICK_RATE,


    rawTimingFields:
      {

        timeLaunch:
          finite(
            episode.timeLaunch
          ),

        attackableTime:
          finite(
            episode.attackableTime
          ),

        endAttackableTime:
          finite(
            episode.endAttackableTime
          )
      },


    semanticStatus:
      'OBSERVED_CONTESTABLE_FLYING_SOUL_STIMULUS_EXISTS',


    downstreamGuardrail:
      'Existence alone does not establish that any particular player could see, reach, aim at, or shoot the orb.'
  };
}


// ============================================================
// EPISODE END
// ============================================================

function getEpisodeEndTick(
  episode
) {

  const firstEnd =
    finite(
      episode?.firstEndTick
    );


  if (
    firstEnd !==
      null
  ) {

    return firstEnd;
  }


  const logicalEnd =
    finite(
      episode?.logicalEndTick
    );


  if (
    logicalEnd !==
      null
    &&
    String(
      episode?.logicalEndReason ??
      ''
    ) !==
    'REPLAY_END'
  ) {

    return logicalEnd;
  }


  return null;
}


// ============================================================
// PLAYER ROSTER
// ============================================================

async function loadPlayerRoster({

  playerStatePath,

  expectedNames
}) {

  const expectedSet =
    new Set(
      expectedNames
    );


  const roster =
    new Map();


  const reader =
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


  let rowsRead =
    0;


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


    rowsRead++;


    const controller =
      row.controller
      ??
      null;


    if (
      !controller
    ) {

      continue;
    }


    const playerName =
      controller.playerName
      ??
      null;


    if (
      !playerName
      ||
      (
        expectedSet.size >
        0
        &&
        !expectedSet.has(
          playerName
        )
      )
    ) {

      continue;
    }


    const old =
      roster.get(
        playerName
      )
      ??
      {};


    const candidate =
      {

        playerName,

        steamId:
          controller.steamId
          ??
          old.steamId
          ??
          null,

        team:
          finite(
            controller.team
          )
          ??
          old.team
          ??
          null,

        heroId:
          finite(
            controller.heroId
          )
          ??
          old.heroId
          ??
          null,

        controllerEntityIndex:
          finite(
            controller.entityIndex
          )
          ??
          old.controllerEntityIndex
          ??
          null,

        pawnEntityIndex:
          finite(
            row
              ?.pawn
              ?.entityIndex
          )
          ??
          old.pawnEntityIndex
          ??
          null
      };


    roster.set(
      playerName,
      candidate
    );


    const complete =
      expectedNames.length >
      0
      &&
      expectedNames.every(
        name => {

          const player =
            roster.get(
              name
            );


          return (
            player
            &&
            isGameTeam(
              player.team
            )
          );
        }
      );


    if (
      complete
    ) {

      break;
    }
  }


  return {

    rowsReadForRoster:
      rowsRead,

    players:
      [
        ...roster.values()
      ]
        .sort(
          (
            a,
            b
          ) =>
            a.playerName.localeCompare(
              b.playerName
            )
        )
  };
}


// ============================================================
// ROLE
//
// IMPORTANT:
//
// Orb team == dead Trooper team.
//
// Same-orb-team player:
//   denying their own team's dead Trooper soul.
//
// Opposing-orb-team player:
//   securing the killed enemy Trooper soul.
//
// ============================================================

function classifyRole(
  playerTeam,
  orbTeam
) {

  if (
    !isGameTeam(
      playerTeam
    )
    ||
    !isGameTeam(
      orbTeam
    )
  ) {

    return 'ROLE_UNRESOLVED';
  }


  return playerTeam ===
    orbTeam
    ? 'DENY_CANDIDATE'
    : 'SECURE_CANDIDATE';
}


// ============================================================
// STREAM PLAYER STATE AGAINST EVENT INTERVALS
// ============================================================

async function processPlayerState({

  playerStatePath,

  events,

  candidateMap
}) {

  const sortedEvents =
    [
      ...events
    ]
      .sort(
        (
          a,
          b
        ) =>
          a.startTick -
          b.startTick
      );


  let nextEventIndex =
    0;


  let activeEvents =
    [];


  let currentTick =
    null;


  let rowsRead =
    0;


  let rowsParsed =
    0;


  let parseFailures =
    0;


  let rowsInsideAnyEvent =
    0;


  let aliveRowsInsideAnyEvent =
    0;


  let validPositionRowsInsideAnyEvent =
    0;


  const reader =
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
    of reader
  ) {

    rowsRead++;


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

      parseFailures++;

      continue;
    }


    rowsParsed++;


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


    // --------------------------------------------------------
    // UPDATE ACTIVE EVENT SWEEP
    // --------------------------------------------------------

    if (
      currentTick !==
      tick
    ) {

      currentTick =
        tick;


      while (
        nextEventIndex <
        sortedEvents.length
        &&
        sortedEvents[
          nextEventIndex
        ].startTick <=
        tick
      ) {

        const event =
          sortedEvents[
            nextEventIndex
          ];


        if (
          event.endTick >=
          tick
        ) {

          activeEvents.push(
            event
          );
        }


        nextEventIndex++;
      }


      activeEvents =
        activeEvents.filter(
          event =>
            event.endTick >=
            tick
        );
    }


    if (
      activeEvents.length ===
      0
    ) {

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


    rowsInsideAnyEvent++;


    const alive =
      row
        ?.controller
        ?.alive ===
      true;


    if (
      alive
    ) {

      aliveRowsInsideAnyEvent++;
    }


    const positionValid =
      row
        ?.pawn
        ?.positionValidForMovement ===
      true;


    const position =
      positionValid
        ? normalizePosition(
            row
              ?.pawn
              ?.positionWorld
          )
        : null;


    if (
      position
    ) {

      validPositionRowsInsideAnyEvent++;
    }


    for (
      const event
      of activeEvents
    ) {

      const candidateId =
        `${event.eventId}|${playerName}`;


      const candidate =
        candidateMap.get(
          candidateId
        );


      if (
        !candidate
      ) {

        continue;
      }


      updateCandidateFromState({

        candidate,

        row,

        tick,

        alive,

        position
      });
    }
  }


  return {

    rowsRead,

    rowsParsed,

    parseFailures,

    rowsInsideAnyEvent,

    aliveRowsInsideAnyEvent,

    validPositionRowsInsideAnyEvent
  };
}


// ============================================================
// UPDATE CANDIDATE
// ============================================================

function updateCandidateFromState({

  candidate,

  row,

  tick,

  alive,

  position
}) {

  const observation =
    candidate.observation;


  observation.sampleCountDuringExistence++;


  const snapshot =
    compactStateSnapshot(
      row
    );


  if (
    !observation.firstObservedSample
  ) {

    observation.firstObservedSample =
      snapshot;
  }


  if (
    alive
  ) {

    observation.aliveSampleCount++;


    if (
      !observation.firstAliveSample
    ) {

      observation.firstAliveSample =
        snapshot;
    }


    observation.lastAliveSample =
      snapshot;
  }


  if (
    !position
  ) {

    return;
  }


  observation.validPositionSampleCount++;


  const geometry =
    candidate.spawnAnchorGeometry;


  const spawnPosition =
    candidate
      .stimulus
      .spawnPosition;


  const xy =
    distanceXY(
      position,
      spawnPosition
    );


  const threeD =
    distance3D(
      position,
      spawnPosition
    );


  if (
    geometry.firstValidXY ===
    null
  ) {

    geometry.firstValidXY =
      xy;


    geometry.firstValid3D =
      threeD;
  }


  if (
    geometry.minimum3D ===
      null
    ||
    threeD <
      geometry.minimum3D
  ) {

    geometry.minimumXY =
      xy;


    geometry.minimum3D =
      threeD;


    geometry.minimumTick =
      tick;


    geometry.closestSample =
      {

        ...snapshot,

        position,

        distanceXYToSpawnAnchor:
          xy,

        distance3DToSpawnAnchor:
          threeD
      };
  }
}


// ============================================================
// STATE SNAPSHOT
// ============================================================

function compactStateSnapshot(
  row
) {

  return {

    demoTick:
      finite(
        row.demoTick
      ),

    matchTimeSeconds:
      finite(
        row.matchTimeSeconds
      ),

    matchMinute:
      finite(
        row.matchMinute
      ),

    matchClock:
      row.matchClock
      ??
      null,

    alive:
      row
        ?.controller
        ?.alive ===
      true,

    health:
      finite(
        row
          ?.pawn
          ?.health
      ),

    maxHealth:
      finite(
        row
          ?.pawn
          ?.maxHealth
      ),

    netWorth:
      finite(
        row
          ?.controller
          ?.netWorth
      ),

    assignedLane:
      finite(
        row
          ?.controller
          ?.assignedLane
      ),

    deducedLane:
      finite(
        row
          ?.pawn
          ?.deducedLane
      ),

    inRegenZone:
      booleanOrNull(
        row
          ?.pawn
          ?.inRegenZone
      ),

    inItemShopZone:
      booleanOrNull(
        row
          ?.pawn
          ?.inItemShopZone
      )
  };
}


// ============================================================
// FINALIZE CANDIDATE
// ============================================================

function finalizeCandidate(
  candidate
) {

  const observed =
    candidate
      .observation
      .sampleCountDuringExistence >
    0;


  const aliveObserved =
    candidate
      .observation
      .aliveSampleCount >
    0;


  const roleResolved =
    candidate
      .role
      .mechanicallyResolved;


  let tier;


  if (
    !roleResolved
  ) {

    tier =
      'ROLE_UNRESOLVED';

  } else if (
    !observed
  ) {

    tier =
      'STIMULUS_EXISTS_PLAYER_STATE_NOT_SAMPLED_DURING_EXISTENCE';

  } else if (
    !aliveObserved
  ) {

    tier =
      'STIMULUS_EXISTS_ROLE_ELIGIBLE_PLAYER_NOT_OBSERVED_ALIVE';

  } else {

    tier =
      'STIMULUS_EXISTS_ROLE_ELIGIBLE_ALIVE_ACCESSIBILITY_UNRESOLVED';
  }


  candidate.eligibility =
    {

      stimulusExists:
        true,

      roleResolved,

      aliveObservedDuringExistence:
        aliveObserved,

      firstAliveObservedTick:
        candidate
          .observation
          .firstAliveSample
          ?.demoTick
        ??
        null,

      lastAliveObservedTick:
        candidate
          .observation
          .lastAliveSample
          ?.demoTick
        ??
        null,

      tier,

      accessibilityClass:
        'NOT_YET_CLASSIFIED',

      responseClass:
        'NOT_YET_CLASSIFIED',

      outcomeClass:
        'NOT_YET_CLASSIFIED'
    };


  candidate.interpretation =
    {

      mayEnterStimulusExistenceDenominator:
        roleResolved,

      mayEnterAliveCandidateDenominator:
        roleResolved
        &&
        aliveObserved,

      mayEnterAccessibleOpportunityDenominator:
        false,

      reason:
        'Accessibility requires the moving-orb trajectory, attackable interval, and further geometry/visibility evidence.'
    };


  return candidate;
}


// ============================================================
// POSITION / DISTANCE
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
// IDS / TEAM
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
        )
        ??
        0
      )
      +
      1
    );
  }


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
          a[0].localeCompare(
            b[0]
          )
      )
  );
}


function mergeCountObjects(
  objects
) {

  const map =
    new Map();


  for (
    const object
    of objects
  ) {

    for (
      const [
        key,
        value
      ]
      of Object.entries(
        object
        ??
        {}
      )
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
        value
      );
    }
  }


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
          a[0].localeCompare(
            b[0]
          )
      )
  );
}


// ============================================================
// VALUE HELPERS
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
      total,
      value
    ) =>
      total +
      value,
    0
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
    'SOURCE-LINKED STIMULI'
  );


  console.log(
    `  economic Trooper deaths: ${row.sourceLink.economicTrooperDeaths}`
  );


  console.log(
    `  candidate orb episodes:  ${row.sourceLink.candidateOrbEpisodes}`
  );


  console.log(
    `  strict flying-soul links: ${row.sourceLink.strictLinks}`
  );


  console.log(
    `  source link median 3D:    ${formatNumber(
      row.sourceLink.strictDistance3D.median
    )} HU`
  );


  console.log(
    `  source tick median:       ${formatNumber(
      row.sourceLink.strictTickDelta.median
    )}`
  );


  console.log('');

  console.log(
    'PLAYER ROLE CANDIDATES'
  );


  console.log(
    `  roster:                   ${row.roster.players}`
  );


  console.log(
    `  total:                    ${row.candidates.total}`
  );


  console.log(
    `  secure:                   ${row.candidates.secure}`
  );


  console.log(
    `  deny:                     ${row.candidates.deny}`
  );


  console.log(
    `  role unresolved:          ${row.candidates.unresolvedRole}`
  );


  console.log('');

  console.log(
    'ALIVE-STATE OVERLAP'
  );


  console.log(
    `  all candidates:           ${row.candidates.aliveObserved}/${row.candidates.total} (${formatPercent(
      row.candidates.aliveObservedRate
    )})`
  );


  console.log(
    `  secure:                   ${row.candidates.secureAliveObserved}/${row.candidates.secure} (${formatPercent(
      row.candidates.secureAliveObservedRate
    )})`
  );


  console.log(
    `  deny:                     ${row.candidates.denyAliveObserved}/${row.candidates.deny} (${formatPercent(
      row.candidates.denyAliveObservedRate
    )})`
  );


  console.log('');

  console.log(
    'SPAWN-ANCHOR GEOMETRY'
  );


  console.log(
    `  alive min XY median:      ${formatNumber(
      row.candidateGeometry.aliveMinXY.median
    )} HU`
  );


  console.log(
    `  alive min 3D median:      ${formatNumber(
      row.candidateGeometry.aliveMin3D.median
    )} HU`
  );


  console.log(
    '  interpretation:           DESCRIPTIVE ONLY'
  );


  console.log('');

  console.log(
    `VALIDATION:                 ${row.validation.pass ? 'PASS' : 'FAIL'}`
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
    '# Flying-Soul Opportunity Existence Layer'
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
    '## Behavioral hierarchy'
  );


  lines.push(
    ''
  );


  lines.push(
    'This layer establishes **stimulus existence, player role, and observed alive-state overlap only**.'
  );


  lines.push(
    ''
  );


  lines.push(
    'It does not yet classify spatial accessibility, line of sight, aimability, response attempts, success, failure, or ignored opportunities.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Role semantics'
  );


  lines.push(
    ''
  );


  lines.push(
    '- Player team equals orb team -> `DENY_CANDIDATE`.'
  );


  lines.push(
    '- Player team opposes orb team -> `SECURE_CANDIDATE`.'
  );


  lines.push(
    '- Melee-finished Troopers with no flying orb produce no flying-soul candidate event.'
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
      `- Source-linked flying souls: ${replay.sourceLink.strictLinks}`
    );


    lines.push(
      `- Player candidates: ${replay.candidates.total}`
    );


    lines.push(
      `- Secure candidates: ${replay.candidates.secure}`
    );


    lines.push(
      `- Deny candidates: ${replay.candidates.deny}`
    );


    lines.push(
      `- Observed alive during stimulus existence: ${formatPercent(replay.candidates.aliveObservedRate)}`
    );


    lines.push(
      `- Validation: **${replay.validation.pass ? 'PASS' : 'FAIL'}**`
    );


    lines.push(
      ''
    );
  }


  lines.push(
    '## Geometry warning'
  );


  lines.push(
    ''
  );


  lines.push(
    'Distance fields in this layer use the fixed flying-soul **spawn anchor**. They are descriptive context only and must not be used as a final accessibility/opportunity threshold.'
  );


  lines.push(
    ''
  );


  lines.push(
    '## Next stage'
  );


  lines.push(
    ''
  );


  lines.push(
    summary.interpretation.nextQuestion
  );


  lines.push(
    ''
  );


  return lines.join(
    '\n'
  );
}