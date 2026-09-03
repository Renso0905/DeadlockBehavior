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

import readline from 'node:readline';


// ============================================================
// SETTINGS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';


const TICK_RATE =
    64;


const MATCH_CLOCK_OFFSET_SECONDS =
    30;


// ------------------------------------------------------------
// Spatial episode thresholds.
//
// These are operational definitions, NOT claims that the
// player actually perceived the resource.
// ------------------------------------------------------------

const BREAKABLE_ENTER_RADIUS =
    500;


const BREAKABLE_EXIT_RADIUS =
    800;


const CAMP_ENTER_RADIUS =
    800;


const CAMP_EXIT_RADIUS =
    1200;


// Spatial grid used only to reduce episode-opening work.
const GRID_SIZE =
    800;


// Reject implausibly large movement steps.
//
// Death holding coordinates are separately blocked using
// pawn.positionValidForMovement.
const MAX_VALID_MOVEMENT_STEP =
    2000;


// Low-motion descriptive threshold.
//
// This is NOT currently being interpreted as idling.
const LOW_MOTION_SPEED_THRESHOLD =
    25;


// State snapshots approximately once per second per player.
//
// Only alive + movement-position-valid rows receive spatial
// opportunity snapshots.
const SNAPSHOT_INTERVAL_SECONDS =
    1;


// ============================================================
// PATHS
// ============================================================

const playerStatePath =
    resolve(
        'output',
        replayName,
        'player_state.jsonl'
    );


const breakablePath =
    resolve(
        'output',
        replayName,
        'breakable_catalog_v1.json'
    );


const campPathCandidates =
    [

        resolve(
            'inspector',
            'data',
            replayName,
            'v02_overlays.json'
        ),

        resolve(
            'output',
            replayName,
            'v02_overlays.json'
        )
    ];


const meleePathCandidates =
    [

        resolve(
            'output',
            replayName,
            'verified_melee_events.jsonl'
        ),

        resolve(
            'inspector',
            'data',
            replayName,
            'verified_melee_events.jsonl'
        )
    ];


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'behavioral_metrics_v01.json'
    );


const outputEpisodesPath =
    resolve(
        'output',
        replayName,
        'behavioral_resource_episodes_v01.jsonl'
    );


const outputSnapshotsPath =
    resolve(
        'output',
        replayName,
        'behavioral_state_1s_v01.jsonl'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

if (
    !existsSync(
        playerStatePath
    )
) {

    throw new Error(
        `Missing required player state file:\n${playerStatePath}`
    );
}


if (
    !existsSync(
        breakablePath
    )
) {

    throw new Error(
        `Missing required breakable catalog:\n${breakablePath}`
    );
}


const campPath =
    firstExistingPath(
        campPathCandidates
    );


if (
    !campPath
) {

    throw new Error(
        [
            'Could not find v02_overlays.json.',
            '',
            'Checked:',
            ...campPathCandidates
        ].join(
            '\n'
        )
    );
}


const meleePath =
    firstExistingPath(
        meleePathCandidates
    );


// ============================================================
// LOAD RESOURCE INPUTS
// ============================================================

const breakableCatalog =
    JSON.parse(
        readFileSync(
            breakablePath,
            'utf8'
        )
    );


const overlays =
    JSON.parse(
        readFileSync(
            campPath,
            'utf8'
        )
    );


if (
    breakableCatalog
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'breakable_catalog_v1.json is not validation PASS.'
    );
}


// ============================================================
// OUTPUT DIRECTORY
// ============================================================

mkdirSync(
    dirname(
        outputSummaryPath
    ),
    {
        recursive: true
    }
);


// ============================================================
// RESOURCE OBJECTS
// ============================================================

const resources =
    [];


const resourceByKey =
    new Map();


// ============================================================
// BREAKABLE RESOURCES
// ============================================================

for (
    const slot
    of breakableCatalog.slots
    ??
    []
) {

    // --------------------------------------------------------
    // IMPORTANT:
    //
    // Use the persistent slot worldPosition.
    //
    // Do NOT use debris damagePos / impactPosition as the
    // canonical resource location.
    // --------------------------------------------------------

    const position =
        normalizePosition(
            slot.worldPosition
        );


    if (
        !position
    ) {

        continue;
    }


    const key =
        `BREAKABLE:${
            slot.breakableId
            ??
            slot.entityIndex
        }`;


    const intervals =
        (
            slot
                ?.lifecycle
                ?.availableIntervals
            ??
            []
        )

            .map(
                interval => ({

                    start:
                        finite(
                            interval.startMatchTimeSeconds
                        ),

                    end:
                        finite(
                            interval.endMatchTimeSeconds
                        )
                })
            )

            .filter(
                interval =>
                    interval.start !==
                    null
                    &&
                    interval.end !==
                    null
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.start -
                    b.start
            );


    const consumptionEvents =
        (
            slot.breakEvents
            ??
            []
        )

            .map(
                event => ({

                    time:
                        finite(
                            event.breakMatchTimeSeconds
                        ),

                    clock:
                        event.breakClock
                        ??
                        null,

                    eventType:
                        'BREAK',

                    breakKey:
                        event.breakKey
                        ??
                        null,

                    canonicalBreaker:
                        event.canonicalBreaker
                        ??
                        null,

                    rewardOutcome:
                        event.rewardOutcome
                        ??
                        null
                })
            )

            .filter(
                event =>
                    event.time !==
                    null
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.time -
                    b.time
            );


    const resource =
        {

            key,

            objectKind:
                'BREAKABLE',

            objectId:
                String(
                    slot.breakableId
                    ??
                    slot.entityIndex
                ),

            subtype:
                slot.type
                ??
                'UNKNOWN',

            tier:
                null,

            position,

            enterRadius:
                BREAKABLE_ENTER_RADIUS,

            exitRadius:
                BREAKABLE_EXIT_RADIUS,

            intervals,

            consumptionEvents,

            source:
                {

                    entityIndex:
                        finite(
                            slot.entityIndex
                        ),

                    subclassId:
                        serialize(
                            slot.subclassId
                        ),

                    spawnCohort:
                        slot
                            ?.spawn
                            ?.cohort
                        ??
                        null
                }
        };


    resources.push(
        resource
    );


    resourceByKey.set(
        key,
        resource
    );
}


// ============================================================
// CAMP RESOURCES
// ============================================================

for (
    const camp
    of overlays.camps
    ??
    []
) {

    const position =
        normalizePosition(
            camp.worldPosition
        );


    if (
        !position
    ) {

        continue;
    }


    const key =
        `CAMP:${
            camp.campId
            ??
            camp.name
        }`;


    const tier =
        normalizeCampTier(
            camp.tier
        );


    const intervals =
        (
            camp.intervals
            ??
            []
        )

            .filter(
                interval =>
                    interval.state ===
                    'AVAILABLE'
            )

            .map(
                interval => ({

                    start:
                        finite(
                            interval.startTimeSeconds
                        ),

                    end:
                        finite(
                            interval.endTimeSeconds
                        )
                })
            )

            .filter(
                interval =>
                    interval.start !==
                    null
                &&
                    interval.end !==
                    null
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.start -
                    b.start
            );


    const consumptionEvents =
        (
            camp.clearEvents
            ??
            []
        )

            .map(
                event => ({

                    time:
                        finite(
                            event.timeSeconds
                        ),

                    clock:
                        event.clock
                        ??
                        null,

                    eventType:
                        'CAMP_CLEAR',

                    breakKey:
                        null,

                    canonicalBreaker:
                        null,

                    rewardOutcome:
                        null
                })
            )

            .filter(
                event =>
                    event.time !==
                    null
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.time -
                    b.time
            );


    const resource =
        {

            key,

            objectKind:
                'CAMP',

            objectId:
                String(
                    camp.campId
                    ??
                    camp.name
                ),

            subtype:
                'NEUTRAL_CAMP',

            tier,

            position,

            enterRadius:
                CAMP_ENTER_RADIUS,

            exitRadius:
                CAMP_EXIT_RADIUS,

            intervals,

            consumptionEvents,

            source:
                {

                    fowIndex:
                        finite(
                            camp.fowIndex
                        ),

                    memberCount:
                        finite(
                            camp.memberCount
                        ),

                    respawnDurationSeconds:
                        finite(
                            camp.respawnDurationSeconds
                        )
                }
        };


    resources.push(
        resource
    );


    resourceByKey.set(
        key,
        resource
    );
}


// ============================================================
// RESOURCE COUNTS
// ============================================================

const breakableResources =
    resources.filter(
        resource =>
            resource.objectKind ===
            'BREAKABLE'
    );


const campResources =
    resources.filter(
        resource =>
            resource.objectKind ===
            'CAMP'
    );


const crateResources =
    breakableResources.filter(
        resource =>
            resource.subtype ===
            'CRATE'
    );


const statueResources =
    breakableResources.filter(
        resource =>
            resource.subtype ===
            'GOLDEN_STATUE'
    );


// ============================================================
// SPATIAL GRID
// ============================================================

const resourceGrid =
    new Map();


for (
    const resource
    of resources
) {

    const cell =
        gridCell(
            resource.position
        );


    const key =
        gridKey(
            cell.x,
            cell.y
        );


    if (
        !resourceGrid.has(
            key
        )
    ) {

        resourceGrid.set(
            key,
            []
        );
    }


    resourceGrid
        .get(
            key
        )
        .push(
            resource
        );
}


// ============================================================
// OUTPUT STREAMS
// ============================================================

const episodeStream =
    createWriteStream(
        outputEpisodesPath,
        {
            encoding:
                'utf8'
        }
    );


const snapshotStream =
    createWriteStream(
        outputSnapshotsPath,
        {
            encoding:
                'utf8'
        }
    );


// ============================================================
// PLAYER RUNTIME STATE
// ============================================================

const players =
    new Map();


// playerName -> Map(resource.key -> episode)
const activeEpisodes =
    new Map();


// ============================================================
// PROCESSING COUNTERS
// ============================================================

let totalPlayerRows =
    0;


let parsedPlayerRows =
    0;


let schemaRejectedRows =
    0;


let usablePlayerRows =
    0;


let preMatchRows =
    0;


let deadPlayerRows =
    0;


let movementInvalidRows =
    0;


let spatialEligibleRows =
    0;


let snapshotCount =
    0;


let episodeCount =
    0;


// ============================================================
// CONSOLE HEADER
// ============================================================

console.log('');

console.log(
    '====================================='
);

console.log(
    'BEHAVIORAL METRICS V0.1'
);

console.log(
    '====================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log('');

console.log(
    `Breakables: ${breakableResources.length}`
);

console.log(
    `  crates: ${crateResources.length}`
);

console.log(
    `  statues: ${statueResources.length}`
);

console.log(
    `Camps: ${campResources.length}`
);

console.log(
    `Total resource objects: ${resources.length}`
);

console.log('');

console.log(
    `Player state: ${playerStatePath}`
);

console.log(
    `Breakables:  ${breakablePath}`
);

console.log(
    `Camps:       ${campPath}`
);

console.log(
    `Melee:       ${
        meleePath
        ??
        'not found — optional'
    }`
);

console.log('');


// ============================================================
// READ PLAYER STATE
// ============================================================

const playerReader =
    readline.createInterface({

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


    totalPlayerRows++;


    let row;


    try {

        row =
            JSON.parse(
                line
            );

    } catch {

        continue;
    }


    parsedPlayerRows++;


    // ========================================================
    // ACTUAL SCRIPT 03 PLAYER-STATE SCHEMA
    //
    // top-level:
    //
    // demoTick
    // demoSeconds
    // matchTimeSeconds
    // matchMinute
    // matchClock
    // isPregame
    // gameState
    // controller { ... }
    // pawn { ... }
    // ========================================================

    const playerName =
        extractPlayerName(
            row
        );


    const time =
        extractMatchTime(
            row
        );


    const position =
        extractWorldPosition(
            row
        );


    if (
        !playerName
        ||
        time ===
            null
        ||
        !position
    ) {

        schemaRejectedRows++;

        continue;
    }


    usablePlayerRows++;


    if (
        time <
        0
    ) {

        preMatchRows++;

        continue;
    }


    const alive =
        extractAlive(
            row
        );


    const positionValidForMovement =
        extractPositionValidForMovement(
            row
        );


    const spatialEligible =
        (
            alive
            &&
            positionValidForMovement
        );


    const player =
        getOrCreatePlayer(
            playerName,
            row
        );


    // Refresh stable metadata if an earlier row lacked it.
    refreshPlayerMetadata(
        player,
        row
    );


    const previous =
        player.lastSample;


    let deltaSeconds =
        null;


    let movementXY =
        null;


    let movement3D =
        null;


    let speedXY =
        null;


    let speed3D =
        null;


    // ========================================================
    // TIME / MOVEMENT
    // ========================================================

    if (
        previous
        &&
        time >
            previous.time
    ) {

        deltaSeconds =
            time -
            previous.time;


        // ----------------------------------------------------
        // Alive-duration estimate.
        //
        // Require both sides of the interval to be alive.
        // ----------------------------------------------------

        if (
            previous.alive
            &&
            alive
            &&
            deltaSeconds <=
                1
        ) {

            player.aliveSeconds +=
                deltaSeconds;
        }


        // ----------------------------------------------------
        // Movement.
        //
        // Require canonical pawn movement validity on BOTH
        // samples.
        // ----------------------------------------------------

        if (
            previous.spatialEligible
            &&
            spatialEligible
            &&
            deltaSeconds <=
                1
        ) {

            movementXY =
                distanceXY(
                    previous.position,
                    position
                );


            movement3D =
                distance3D(
                    previous.position,
                    position
                );


            if (
                movement3D <=
                MAX_VALID_MOVEMENT_STEP
            ) {

                speedXY =
                    movementXY /
                    deltaSeconds;


                speed3D =
                    movement3D /
                    deltaSeconds;


                player.movement.travelDistanceXY +=
                    movementXY;


                player.movement.travelDistance3D +=
                    movement3D;


                player.movement.validMovementSeconds +=
                    deltaSeconds;


                if (
                    speed3D <
                    LOW_MOTION_SPEED_THRESHOLD
                ) {

                    player.movement.lowMotionSeconds +=
                        deltaSeconds;
                }


                if (
                    speed3D >=
                    LOW_MOTION_SPEED_THRESHOLD
                ) {

                    player.movement.movingSeconds +=
                        deltaSeconds;
                }


            } else {

                player.movement.rejectedJumpCount++;
            }
        }
    }


    // ========================================================
    // INVALID SPATIAL STATE
    //
    // The pawn file explicitly tells us when its position
    // should not be used for movement.
    //
    // This protects us from dead holding coordinates.
    // ========================================================

    if (
        !spatialEligible
    ) {

        if (
            !alive
        ) {

            deadPlayerRows++;

        } else {

            movementInvalidRows++;
        }


        closeAllPlayerEpisodes(
            playerName,
            time,
            position,
            !alive
                ? 'PLAYER_DEAD'
                : 'POSITION_INVALID'
        );


        player.lastSample =
            {

                time,

                position,

                alive,

                positionValidForMovement,

                spatialEligible,

                speedXY,

                speed3D
            };


        continue;
    }


    spatialEligibleRows++;


    // ========================================================
    // UPDATE EXISTING RESOURCE EPISODES
    // ========================================================

    updateActiveEpisodes(
        playerName,
        time,
        position
    );


    // ========================================================
    // OPEN NEW RESOURCE EPISODES
    // ========================================================

    const nearbyCandidates =
        nearbyResources(
            position,
            CAMP_ENTER_RADIUS
        );


    const playerEpisodes =
        getPlayerEpisodeMap(
            playerName
        );


    for (
        const resource
        of nearbyCandidates
    ) {

        if (
            playerEpisodes.has(
                resource.key
            )
        ) {

            continue;
        }


        if (
            !isAvailableAt(
                resource,
                time
            )
        ) {

            continue;
        }


        const d3 =
            distance3D(
                position,
                resource.position
            );


        if (
            d3 >
            resource.enterRadius
        ) {

            continue;
        }


        const dxy =
            distanceXY(
                position,
                resource.position
            );


        const dz =
            verticalDistance(
                position,
                resource.position
            );


        const episode =
            {

                schemaVersion:
                    1,

                playerName,

                heroId:
                    player.heroId,

                team:
                    player.team,

                resourceKey:
                    resource.key,

                objectKind:
                    resource.objectKind,

                objectId:
                    resource.objectId,

                subtype:
                    resource.subtype,

                tier:
                    resource.tier,

                resourcePosition:
                    resource.position,

                startTimeSeconds:
                    time,

                startClock:
                    formatClock(
                        time
                    ),

                startPlayerPosition:
                    position,

                startDistance3D:
                    d3,

                startDistanceXY:
                    dxy,

                startVerticalDistance:
                    dz,

                minDistance3D:
                    d3,

                minDistanceXY:
                    dxy,

                minVerticalDistance:
                    dz,

                lastDistance3D:
                    d3,

                lastDistanceXY:
                    dxy,

                lastVerticalDistance:
                    dz,

                sampleCount:
                    1
            };


        playerEpisodes.set(
            resource.key,
            episode
        );
    }


    // ========================================================
    // 1-SECOND SPATIAL STATE SNAPSHOT
    // ========================================================

    const snapshotBucket =
        Math.floor(
            time /
            SNAPSHOT_INTERVAL_SECONDS
        );


    if (
        snapshotBucket >
        player.lastSnapshotBucket
    ) {

        player.lastSnapshotBucket =
            snapshotBucket;


        const snapshot =
            buildSnapshot(
                player,
                row,
                time,
                position,
                speedXY,
                speed3D
            );


        snapshotStream.write(
            JSON.stringify(
                snapshot
            )
            +
            '\n'
        );


        snapshotCount++;
    }


    // ========================================================
    // SAVE SAMPLE
    // ========================================================

    player.lastSample =
        {

            time,

            position,

            alive,

            positionValidForMovement,

            spatialEligible,

            speedXY,

            speed3D
        };
}


// ============================================================
// CLOSE REPLAY-END EPISODES
// ============================================================

let finalMatchTime =
    0;


for (
    const player
    of players.values()
) {

    if (
        player
            ?.lastSample
            ?.time >
        finalMatchTime
    ) {

        finalMatchTime =
            player.lastSample.time;
    }
}


for (
    const [
        playerName,
        player
    ]
    of players.entries()
) {

    if (
        !player.lastSample
    ) {

        continue;
    }


    closeAllPlayerEpisodes(
        playerName,
        finalMatchTime,
        player.lastSample.position,
        'REPLAY_END'
    );
}


// ============================================================
// FINISH STREAMS
// ============================================================

await closeWriteStream(
    episodeStream
);


await closeWriteStream(
    snapshotStream
);


// ============================================================
// OPTIONAL MELEE SUMMARY
// ============================================================

const meleeSummary =
    await loadMeleeSummary(
        meleePath
    );


// ============================================================
// CANONICAL BREAKABLE ACTION SUMMARY
//
// IMPORTANT:
//
// Known breaker != necessarily confirmed reward collector.
// ============================================================

const breakableActionsByPlayer =
    new Map();


for (
    const event
    of breakableCatalog.breakEvents
    ??
    []
) {

    const breaker =
        event
            ?.canonicalBreaker
            ?.player;


    if (
        event
            ?.canonicalBreaker
            ?.status !==
        'ATTRIBUTED'
        ||
        !breaker?.playerName
    ) {

        continue;
    }


    const playerName =
        breaker.playerName;


    if (
        !breakableActionsByPlayer.has(
            playerName
        )
    ) {

        breakableActionsByPlayer.set(
            playerName,
            emptyBreakableActionSummary()
        );
    }


    const summary =
        breakableActionsByPlayer.get(
            playerName
        );


    summary.totalKnownBreaks++;


    if (
        event.type ===
        'CRATE'
    ) {

        summary.crates++;
    }


    if (
        event.type ===
        'GOLDEN_STATUE'
    ) {

        summary.statues++;
    }


    if (
        event
            ?.canonicalBreaker
            ?.method ===
        'MELEE_DIRECT'
    ) {

        summary.meleeBreaks++;
    }


    if (
        event
            ?.canonicalBreaker
            ?.method ===
        'BULLET_RAY'
    ) {

        summary.bulletBreaks++;
    }


    if (
        event
            ?.rewardOutcome
            ?.dropped ===
        true
    ) {

        summary.rewardDropsProduced++;
    }


    if (
        event
            ?.rewardOutcome
            ?.rewardType ===
        'SOULS'
    ) {

        summary.crateSoulDropsProduced++;


        summary.crateSoulsProduced +=
            finite(
                event
                    ?.rewardOutcome
                    ?.goldReward
            )
            ??
            0;
    }


    if (
        event
            ?.rewardOutcome
            ?.rewardType ===
        'PERMANENT_MODIFIER'
    ) {

        summary.statueModifiersProduced++;
    }
}


// ============================================================
// PLAYER SUMMARIES
// ============================================================

const playerSummaries =
    [];


for (
    const player
    of players.values()
) {

    const episodes =
        player.episodeSummary;


    const breakableActions =
        breakableActionsByPlayer.get(
            player.playerName
        )
        ??
        emptyBreakableActionSummary();


    const melee =
        meleeSummary.byPlayer[
            player.playerName
        ]
        ??
        emptyMeleeSummary();


    playerSummaries.push({

        playerName:
            player.playerName,

        steamId:
            player.steamId,

        heroId:
            player.heroId,

        team:
            player.team,

        controllerEntityIndex:
            player.controllerEntityIndex,

        pawnEntityIndex:
            player.pawnEntityIndex,

        aliveSeconds:
            player.aliveSeconds,

        aliveMinutes:
            player.aliveSeconds /
            60,

        movement:
            {

                travelDistanceXY:
                    player.movement.travelDistanceXY,

                travelDistance3D:
                    player.movement.travelDistance3D,

                validMovementSeconds:
                    player.movement.validMovementSeconds,

                meanSpeedXY:
                    rate(
                        player.movement.travelDistanceXY,
                        player.movement.validMovementSeconds
                    ),

                meanSpeed3D:
                    rate(
                        player.movement.travelDistance3D,
                        player.movement.validMovementSeconds
                    ),

                movingSeconds:
                    player.movement.movingSeconds,

                lowMotionSeconds:
                    player.movement.lowMotionSeconds,

                lowMotionShare:
                    rate(
                        player.movement.lowMotionSeconds,
                        player.movement.validMovementSeconds
                    ),

                rejectedJumpCount:
                    player.movement.rejectedJumpCount
            },

        resourceExposure:
            {

                totalEpisodes:
                    episodes.total,

                breakableEpisodes:
                    episodes.breakable,

                crateEpisodes:
                    episodes.crate,

                statueEpisodes:
                    episodes.statue,

                campEpisodes:
                    episodes.camp,

                campEpisodesByTier:
                    episodes.campByTier,

                outcomes:
                    episodes.outcomes,

                totalEpisodeSeconds:
                    episodes.totalDurationSeconds,

                breakableEpisodeSeconds:
                    episodes.breakableDurationSeconds,

                campEpisodeSeconds:
                    episodes.campDurationSeconds
            },

        knownBreakableActions:
            {

                ...breakableActions,

                knownBreaksPerAliveMinute:
                    rate(
                        breakableActions.totalKnownBreaks,
                        player.aliveSeconds /
                        60
                    )
            },

        melee:
            {

                ...melee,

                attacksPerAliveMinute:
                    rate(
                        melee.total,
                        player.aliveSeconds /
                        60
                    )
            }
    });
}


playerSummaries.sort(
    (
        a,
        b
    ) =>
        a.playerName.localeCompare(
            b.playerName
        )
);


// ============================================================
// VALIDATION
// ============================================================

const validation =
    {

        parsedPlayerRows:
            {

                actual:
                    parsedPlayerRows,

                expected:
                    153420,

                pass:
                    parsedPlayerRows ===
                    153420
            },

        schemaRejectedRows:
            {

                actual:
                    schemaRejectedRows,

                expected:
                    0,

                pass:
                    schemaRejectedRows ===
                    0
            },

        playerCount:
            {

                actual:
                    players.size,

                expected:
                    12,

                pass:
                    players.size ===
                    12
            },

        breakableCount:
            {

                actual:
                    breakableResources.length,

                expected:
                    691,

                pass:
                    breakableResources.length ===
                    691
            },

        crateCount:
            {

                actual:
                    crateResources.length,

                expected:
                    518,

                pass:
                    crateResources.length ===
                    518
            },

        statueCount:
            {

                actual:
                    statueResources.length,

                expected:
                    173,

                pass:
                    statueResources.length ===
                    173
            },

        campCount:
            {

                actual:
                    campResources.length,

                expected:
                    40,

                pass:
                    campResources.length ===
                    40
            },

        canonicalBreakEvents:
            {

                actual:
                    breakableCatalog
                        ?.summary
                        ?.lifecycle
                        ?.totalBreakEvents
                    ??
                    null,

                expected:
                    1261,

                pass:
                    (
                        breakableCatalog
                            ?.summary
                            ?.lifecycle
                            ?.totalBreakEvents
                    ) ===
                    1261
            },

        spatialEligibleRows:
            {

                actual:
                    spatialEligibleRows,

                expected:
                    '>0',

                pass:
                    spatialEligibleRows >
                    0
            },

        snapshotsProduced:
            {

                actual:
                    snapshotCount,

                expected:
                    '>0',

                pass:
                    snapshotCount >
                    0
            },

        episodesProduced:
            {

                actual:
                    episodeCount,

                expected:
                    '>0',

                pass:
                    episodeCount >
                    0
            }
    };


const validationPass =
    Object
        .values(
            validation
        )
        .every(
            check =>
                check.pass
        );


// ============================================================
// FINAL OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BEHAVIORAL_METRICS_V01',

        canonical:
            false,

        interpretation:
            {

                status:
                    'DESCRIPTIVE_BEHAVIORAL_FEATURES',

                importantCaution:
                    'Proximity to an available resource is a spatial opportunity exposure, not proof that the player perceived it, could safely take it, or should have taken it.',

                doNotInferYet:
                    [

                        'missed farm',

                        'bad decision',

                        'reinforcer value',

                        'avoidance',

                        'optimality',

                        'resource ignorance'
                    ],

                reasons:
                    [

                        'visibility is not yet modeled',

                        'pathing and walls are not yet modeled',

                        'enemy threat is not yet modeled',

                        'lane-wave opportunity cost is not yet modeled',

                        'objective context is incomplete'
                    ]
            },

        playerStateSchema:
            {

                playerIdentity:
                    'controller.playerName',

                playerMetadata:
                    'controller',

                pawnState:
                    'pawn',

                worldPosition:
                    'pawn.positionWorld',

                movementValidity:
                    'pawn.positionValidForMovement',

                time:
                    'matchTimeSeconds',

                demoTick:
                    'demoTick'
            },

        sources:
            {

                playerState:
                    playerStatePath,

                breakables:
                    breakablePath,

                camps:
                    campPath,

                melee:
                    meleePath
            },

        thresholds:
            {

                breakable:
                    {

                        enterRadius:
                            BREAKABLE_ENTER_RADIUS,

                        exitRadius:
                            BREAKABLE_EXIT_RADIUS
                    },

                camp:
                    {

                        enterRadius:
                            CAMP_ENTER_RADIUS,

                        exitRadius:
                            CAMP_EXIT_RADIUS
                    },

                movement:
                    {

                        maxAcceptedStep:
                            MAX_VALID_MOVEMENT_STEP,

                        lowMotionSpeedThreshold:
                            LOW_MOTION_SPEED_THRESHOLD
                    },

                snapshots:
                    {

                        intervalSeconds:
                            SNAPSHOT_INTERVAL_SECONDS,

                        eligibility:
                            'alive && pawn.positionValidForMovement'
                    }
            },

        resourceModel:
            {

                total:
                    resources.length,

                breakables:
                    breakableResources.length,

                crates:
                    crateResources.length,

                goldenStatues:
                    statueResources.length,

                camps:
                    campResources.length,

                spatialLocationRule:
                    'Use breakable worldPosition / camp worldPosition. Do not use debris damagePos as canonical resource location.'
            },

        playerStateProcessing:
            {

                totalRows:
                    totalPlayerRows,

                parsedRows:
                    parsedPlayerRows,

                schemaRejectedRows,

                usableSchemaRows:
                    usablePlayerRows,

                preMatchRows,

                deadRows:
                    deadPlayerRows,

                aliveButMovementInvalidRows:
                    movementInvalidRows,

                spatialEligibleRows,

                snapshotsWritten:
                    snapshotCount,

                episodesWritten:
                    episodeCount
            },

        meleeSource:
            meleeSummary.source,

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        players:
            playerSummaries
    };


writeFileSync(

    outputSummaryPath,

    JSON.stringify(
        output,
        null,
        2
    ),

    'utf8'
);


// ============================================================
// CONSOLE OUTPUT
// ============================================================

console.log(
    'PLAYER STATE'
);

console.log(
    '------------'
);

console.log(
    `Rows read: ${totalPlayerRows}`
);

console.log(
    `Rows parsed: ${parsedPlayerRows}`
);

console.log(
    `Schema rejected: ${schemaRejectedRows}`
);

console.log(
    `Pregame rows excluded: ${preMatchRows}`
);

console.log(
    `Dead rows excluded spatially: ${deadPlayerRows}`
);

console.log(
    `Alive but movement-invalid rows: ${movementInvalidRows}`
);

console.log(
    `Spatially eligible match rows: ${spatialEligibleRows}`
);

console.log(
    `Players: ${players.size}`
);

console.log('');

console.log(
    'OUTPUT FEATURES'
);

console.log(
    '---------------'
);

console.log(
    `1-second snapshots: ${snapshotCount}`
);

console.log(
    `Resource episodes: ${episodeCount}`
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
        key,
        check
    ]
    of Object.entries(
        validation
    )
) {

    console.log(
        `${
            check.pass
                ? 'PASS'
                : 'FAIL'
        }  ${
            key.padEnd(
                28
            )
        } actual=${
            check.actual
        } expected=${
            check.expected
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

console.log('');

console.log(
    `Summary:\n${outputSummaryPath}`
);

console.log('');

console.log(
    `Episodes:\n${outputEpisodesPath}`
);

console.log('');

console.log(
    `Snapshots:\n${outputSnapshotsPath}`
);

console.log('');


// ============================================================
// PLAYER CREATION
// ============================================================

function getOrCreatePlayer(
    playerName,
    sourceRow
) {

    if (
        players.has(
            playerName
        )
    ) {

        return players.get(
            playerName
        );
    }


    const player =
        {

            playerName,

            steamId:
                extractSteamId(
                    sourceRow
                ),

            heroId:
                extractHeroId(
                    sourceRow
                ),

            team:
                extractTeam(
                    sourceRow
                ),

            controllerEntityIndex:
                finite(
                    sourceRow
                        ?.controller
                        ?.entityIndex
                ),

            pawnEntityIndex:
                finite(
                    sourceRow
                        ?.pawn
                        ?.entityIndex
                ),

            aliveSeconds:
                0,

            lastSample:
                null,

            lastSnapshotBucket:
                -1,

            movement:
                {

                    travelDistanceXY:
                        0,

                    travelDistance3D:
                        0,

                    validMovementSeconds:
                        0,

                    movingSeconds:
                        0,

                    lowMotionSeconds:
                        0,

                    rejectedJumpCount:
                        0
                },

            episodeSummary:
                {

                    total:
                        0,

                    breakable:
                        0,

                    crate:
                        0,

                    statue:
                        0,

                    camp:
                        0,

                    campByTier:
                        {},

                    outcomes:
                        {},

                    totalDurationSeconds:
                        0,

                    breakableDurationSeconds:
                        0,

                    campDurationSeconds:
                        0
                }
        };


    players.set(
        playerName,
        player
    );


    return player;
}


// ============================================================
// REFRESH PLAYER METADATA
// ============================================================

function refreshPlayerMetadata(
    player,
    row
) {

    if (
        player.steamId ===
        null
    ) {

        player.steamId =
            extractSteamId(
                row
            );
    }


    if (
        player.heroId ===
        null
    ) {

        player.heroId =
            extractHeroId(
                row
            );
    }


    if (
        player.team ===
        null
    ) {

        player.team =
            extractTeam(
                row
            );
    }


    if (
        player.controllerEntityIndex ===
        null
    ) {

        player.controllerEntityIndex =
            finite(
                row
                    ?.controller
                    ?.entityIndex
            );
    }


    if (
        player.pawnEntityIndex ===
        null
    ) {

        player.pawnEntityIndex =
            finite(
                row
                    ?.pawn
                    ?.entityIndex
            );
    }
}


// ============================================================
// ACTIVE EPISODE MAP
// ============================================================

function getPlayerEpisodeMap(
    playerName
) {

    if (
        !activeEpisodes.has(
            playerName
        )
    ) {

        activeEpisodes.set(
            playerName,
            new Map()
        );
    }


    return activeEpisodes.get(
        playerName
    );
}


// ============================================================
// UPDATE ACTIVE EPISODES
// ============================================================

function updateActiveEpisodes(
    playerName,
    time,
    position
) {

    const episodes =
        getPlayerEpisodeMap(
            playerName
        );


    for (
        const [
            resourceKey,
            episode
        ]
        of [
            ...episodes.entries()
        ]
    ) {

        const resource =
            resourceByKey.get(
                resourceKey
            );


        if (
            !resource
        ) {

            episodes.delete(
                resourceKey
            );

            continue;
        }


        // ----------------------------------------------------
        // Did this resource become consumed while this spatial
        // episode was active?
        // ----------------------------------------------------

        const consumption =
            findConsumptionBetween(
                resource,
                episode.startTimeSeconds,
                time
            );


        if (
            consumption
        ) {

            const outcome =
                classifyConsumptionOutcome(
                    playerName,
                    resource,
                    consumption
                );


            closeEpisode(
                playerName,
                resourceKey,
                consumption.time,
                position,
                outcome,
                consumption
            );


            continue;
        }


        const d3 =
            distance3D(
                position,
                resource.position
            );


        const dxy =
            distanceXY(
                position,
                resource.position
            );


        const dz =
            verticalDistance(
                position,
                resource.position
            );


        episode.sampleCount++;


        episode.lastDistance3D =
            d3;


        episode.lastDistanceXY =
            dxy;


        episode.lastVerticalDistance =
            dz;


        episode.minDistance3D =
            Math.min(
                episode.minDistance3D,
                d3
            );


        episode.minDistanceXY =
            Math.min(
                episode.minDistanceXY,
                dxy
            );


        episode.minVerticalDistance =
            Math.min(
                episode.minVerticalDistance,
                dz
            );


        if (
            d3 >
            resource.exitRadius
        ) {

            closeEpisode(
                playerName,
                resourceKey,
                time,
                position,
                'LEFT_AVAILABLE',
                null
            );
        }
    }
}


// ============================================================
// CLOSE ALL PLAYER EPISODES
// ============================================================

function closeAllPlayerEpisodes(
    playerName,
    time,
    position,
    outcome
) {

    const episodes =
        getPlayerEpisodeMap(
            playerName
        );


    for (
        const resourceKey
        of [
            ...episodes.keys()
        ]
    ) {

        closeEpisode(
            playerName,
            resourceKey,
            time,
            position,
            outcome,
            null
        );
    }
}


// ============================================================
// CLOSE EPISODE
// ============================================================

function closeEpisode(
    playerName,
    resourceKey,
    endTime,
    endPlayerPosition,
    outcome,
    consumption
) {

    const episodes =
        getPlayerEpisodeMap(
            playerName
        );


    const episode =
        episodes.get(
            resourceKey
        );


    if (
        !episode
    ) {

        return;
    }


    const durationSeconds =
        Math.max(
            0,
            endTime -
            episode.startTimeSeconds
        );


    const closed =
        {

            ...episode,

            endTimeSeconds:
                endTime,

            endClock:
                formatClock(
                    endTime
                ),

            durationSeconds,

            endPlayerPosition,

            outcome,

            consumption:
                consumption
                ? {

                    eventType:
                        consumption.eventType,

                    timeSeconds:
                        consumption.time,

                    clock:
                        consumption.clock,

                    breakKey:
                        consumption.breakKey,

                    canonicalBreaker:
                        consumption.canonicalBreaker,

                    rewardOutcome:
                        consumption.rewardOutcome
                }
                : null
        };


    episodeStream.write(
        JSON.stringify(
            closed
        )
        +
        '\n'
    );


    episodeCount++;


    const player =
        players.get(
            playerName
        );


    if (
        player
    ) {

        const summary =
            player.episodeSummary;


        summary.total++;


        summary.totalDurationSeconds +=
            durationSeconds;


        if (
            episode.objectKind ===
            'BREAKABLE'
        ) {

            summary.breakable++;


            summary.breakableDurationSeconds +=
                durationSeconds;


            if (
                episode.subtype ===
                'CRATE'
            ) {

                summary.crate++;
            }


            if (
                episode.subtype ===
                'GOLDEN_STATUE'
            ) {

                summary.statue++;
            }
        }


        if (
            episode.objectKind ===
            'CAMP'
        ) {

            summary.camp++;


            summary.campDurationSeconds +=
                durationSeconds;


            incrementObjectCount(
                summary.campByTier,
                episode.tier
                ??
                'UNKNOWN'
            );
        }


        incrementObjectCount(
            summary.outcomes,
            outcome
        );
    }


    episodes.delete(
        resourceKey
    );
}


// ============================================================
// CONSUMPTION OUTCOME
// ============================================================

function classifyConsumptionOutcome(
    playerName,
    resource,
    consumption
) {

    if (
        resource.objectKind ===
        'CAMP'
    ) {

        // We know the camp cleared while the player was in the
        // spatial exposure episode.
        //
        // We do NOT yet claim this player cleared it.
        return 'CAMP_CLEARED_DURING_EPISODE';
    }


    const breaker =
        consumption
            ?.canonicalBreaker
            ?.player
            ?.playerName
        ??
        null;


    const status =
        consumption
            ?.canonicalBreaker
            ?.status
        ??
        null;


    if (
        status ===
        'ATTRIBUTED'
        &&
        breaker ===
        playerName
    ) {

        return 'SELF_BREAK';
    }


    if (
        status ===
        'ATTRIBUTED'
        &&
        breaker
    ) {

        return 'OTHER_PLAYER_BREAK';
    }


    return 'BREAK_ATTRIBUTION_UNKNOWN';
}


// ============================================================
// FIND CONSUMPTION
// ============================================================

function findConsumptionBetween(
    resource,
    start,
    end
) {

    for (
        const event
        of resource.consumptionEvents
    ) {

        if (
            event.time <
            start
        ) {

            continue;
        }


        if (
            event.time >
            end
        ) {

            break;
        }


        return event;
    }


    return null;
}


// ============================================================
// BUILD SPATIAL SNAPSHOT
// ============================================================

function buildSnapshot(
    player,
    sourceRow,
    time,
    position,
    speedXY,
    speed3D
) {

    let nearestCamp =
        null;


    let nearestCrate =
        null;


    let nearestStatue =
        null;


    let availableCampCount =
        0;


    let availableCrateCount =
        0;


    let availableStatueCount =
        0;


    const nearby =
        {

            breakablesWithin300:
                0,

            breakablesWithin500:
                0,

            breakablesWithin800:
                0,

            cratesWithin500:
                0,

            statuesWithin500:
                0,

            campsWithin800:
                0,

            campsWithin1200:
                0,

            smallCampsWithin1200:
                0,

            mediumCampsWithin1200:
                0,

            largeCampsWithin1200:
                0
        };


    for (
        const resource
        of resources
    ) {

        if (
            !isAvailableAt(
                resource,
                time
            )
        ) {

            continue;
        }


        const d3 =
            distance3D(
                position,
                resource.position
            );


        const dxy =
            distanceXY(
                position,
                resource.position
            );


        const dz =
            verticalDistance(
                position,
                resource.position
            );


        if (
            resource.objectKind ===
            'BREAKABLE'
        ) {

            if (
                resource.subtype ===
                'CRATE'
            ) {

                availableCrateCount++;


                if (
                    !nearestCrate
                    ||
                    d3 <
                    nearestCrate.distance3D
                ) {

                    nearestCrate =
                        nearestRecord(
                            resource,
                            d3,
                            dxy,
                            dz
                        );
                }
            }


            if (
                resource.subtype ===
                'GOLDEN_STATUE'
            ) {

                availableStatueCount++;


                if (
                    !nearestStatue
                    ||
                    d3 <
                    nearestStatue.distance3D
                ) {

                    nearestStatue =
                        nearestRecord(
                            resource,
                            d3,
                            dxy,
                            dz
                        );
                }
            }


            if (
                d3 <=
                300
            ) {

                nearby.breakablesWithin300++;
            }


            if (
                d3 <=
                500
            ) {

                nearby.breakablesWithin500++;


                if (
                    resource.subtype ===
                    'CRATE'
                ) {

                    nearby.cratesWithin500++;
                }


                if (
                    resource.subtype ===
                    'GOLDEN_STATUE'
                ) {

                    nearby.statuesWithin500++;
                }
            }


            if (
                d3 <=
                800
            ) {

                nearby.breakablesWithin800++;
            }
        }


        if (
            resource.objectKind ===
            'CAMP'
        ) {

            availableCampCount++;


            if (
                !nearestCamp
                ||
                d3 <
                nearestCamp.distance3D
            ) {

                nearestCamp =
                    nearestRecord(
                        resource,
                        d3,
                        dxy,
                        dz
                    );
            }


            if (
                d3 <=
                800
            ) {

                nearby.campsWithin800++;
            }


            if (
                d3 <=
                1200
            ) {

                nearby.campsWithin1200++;


                if (
                    resource.tier ===
                    'SMALL'
                ) {

                    nearby.smallCampsWithin1200++;
                }


                if (
                    resource.tier ===
                    'MEDIUM'
                ) {

                    nearby.mediumCampsWithin1200++;
                }


                if (
                    resource.tier ===
                    'LARGE'
                ) {

                    nearby.largeCampsWithin1200++;
                }
            }
        }
    }


    const controller =
        sourceRow.controller
        ??
        {};


    const pawn =
        sourceRow.pawn
        ??
        {};


    return {

        schemaVersion:
            1,

        timeSeconds:
            time,

        clock:
            sourceRow.matchClock
            ??
            formatClock(
                time
            ),

        demoTick:
            finite(
                sourceRow.demoTick
            ),

        demoSeconds:
            finite(
                sourceRow.demoSeconds
            ),

        gameState:
            finite(
                sourceRow.gameState
            ),

        playerName:
            player.playerName,

        steamId:
            player.steamId,

        heroId:
            player.heroId,

        team:
            player.team,

        controllerEntityIndex:
            player.controllerEntityIndex,

        pawnEntityIndex:
            player.pawnEntityIndex,

        alive:
            true,

        positionValidForMovement:
            true,

        position,

        health:
            finite(
                pawn.health
                ??
                controller.health
            ),

        maxHealth:
            finite(
                pawn.maxHealth
                ??
                controller.maxHealth
            ),

        netWorth:
            finite(
                controller.netWorth
            ),

        level:
            finite(
                controller.level
            ),

        kills:
            finite(
                controller.kills
            ),

        deaths:
            finite(
                controller.deaths
            ),

        assists:
            finite(
                controller.assists
            ),

        lastHits:
            finite(
                controller.lastHits
            ),

        denies:
            finite(
                controller.denies
            ),

        assignedLane:
            finite(
                controller.assignedLane
            ),

        deducedLane:
            finite(
                pawn.deducedLane
            ),

        inRegenZone:
            pawn.inRegenZone ===
            true,

        hasRejuvenator:
            controller.hasRejuvenator ===
            true,

        movement:
            {

                speedXY,

                speed3D
            },

        mapAvailable:
            {

                camps:
                    availableCampCount,

                crates:
                    availableCrateCount,

                goldenStatues:
                    availableStatueCount
            },

        nearby,

        nearestAvailable:
            {

                camp:
                    nearestCamp,

                crate:
                    nearestCrate,

                goldenStatue:
                    nearestStatue
            },

        activeSpatialEpisodeCount:
            getPlayerEpisodeMap(
                player.playerName
            ).size
    };
}


// ============================================================
// NEAREST RECORD
// ============================================================

function nearestRecord(
    resource,
    distance3DValue,
    distanceXYValue,
    verticalDistanceValue
) {

    return {

        resourceKey:
            resource.key,

        objectId:
            resource.objectId,

        subtype:
            resource.subtype,

        tier:
            resource.tier,

        distance3D:
            distance3DValue,

        distanceXY:
            distanceXYValue,

        verticalDistance:
            verticalDistanceValue
    };
}


// ============================================================
// RESOURCE AVAILABILITY
// ============================================================

function isAvailableAt(
    resource,
    time
) {

    for (
        const interval
        of resource.intervals
    ) {

        if (
            time <
            interval.start
        ) {

            return false;
        }


        if (
            time >=
            interval.start
            &&
            time <
            interval.end
        ) {

            return true;
        }
    }


    return false;
}


// ============================================================
// NEARBY GRID QUERY
// ============================================================

function nearbyResources(
    position,
    maxRadius
) {

    const cell =
        gridCell(
            position
        );


    const cellRadius =
        Math.ceil(
            maxRadius /
            GRID_SIZE
        );


    const result =
        [];


    for (
        let dx =
            -cellRadius;

        dx <=
            cellRadius;

        dx++
    ) {

        for (
            let dy =
                -cellRadius;

            dy <=
                cellRadius;

            dy++
        ) {

            const key =
                gridKey(
                    cell.x +
                    dx,
                    cell.y +
                    dy
                );


            const bucket =
                resourceGrid.get(
                    key
                );


            if (
                bucket
            ) {

                result.push(
                    ...bucket
                );
            }
        }
    }


    return result;
}


// ============================================================
// GRID
// ============================================================

function gridCell(
    position
) {

    return {

        x:
            Math.floor(
                position.x /
                GRID_SIZE
            ),

        y:
            Math.floor(
                position.y /
                GRID_SIZE
            )
    };
}


function gridKey(
    x,
    y
) {

    return `${x}|${y}`;
}


// ============================================================
// ACTUAL PLAYER-STATE SCHEMA EXTRACTORS
// ============================================================

function extractPlayerName(
    row
) {

    const candidates =
        [

            row
                ?.controller
                ?.playerName,

            row.playerName,

            row.name
        ];


    for (
        const candidate
        of candidates
    ) {

        if (
            typeof candidate ===
            'string'
            &&
            candidate.trim()
        ) {

            return candidate.trim();
        }
    }


    return null;
}


// ============================================================
// STEAM ID
// ============================================================

function extractSteamId(
    row
) {

    const value =
        row
            ?.controller
            ?.steamId;


    if (
        value ===
        null
        ||
        value ===
        undefined
    ) {

        return null;
    }


    return String(
        value
    );
}


// ============================================================
// HERO ID
// ============================================================

function extractHeroId(
    row
) {

    return finite(
        row
            ?.controller
            ?.heroId
    );
}


// ============================================================
// TEAM
// ============================================================

function extractTeam(
    row
) {

    return finite(
        row
            ?.controller
            ?.team
        ??
        row
            ?.pawn
            ?.team
    );
}


// ============================================================
// MATCH TIME
// ============================================================

function extractMatchTime(
    row
) {

    const direct =
        finite(
            row.matchTimeSeconds
        );


    if (
        direct !==
        null
    ) {

        return direct;
    }


    const demoSeconds =
        finite(
            row.demoSeconds
        );


    if (
        demoSeconds !==
        null
    ) {

        return (
            demoSeconds -
            MATCH_CLOCK_OFFSET_SECONDS
        );
    }


    const tick =
        finite(
            row.demoTick
        );


    if (
        tick !==
        null
    ) {

        return (
            tick /
            TICK_RATE
        )
        -
        MATCH_CLOCK_OFFSET_SECONDS;
    }


    return null;
}


// ============================================================
// ALIVE
// ============================================================

function extractAlive(
    row
) {

    if (
        typeof row
            ?.controller
            ?.alive ===
        'boolean'
    ) {

        return row.controller.alive;
    }


    const lifeState =
        finite(
            row
                ?.pawn
                ?.lifeState
        );


    if (
        lifeState !==
        null
    ) {

        return (
            lifeState ===
            0
        );
    }


    const health =
        finite(
            row
                ?.pawn
                ?.health
        );


    if (
        health !==
        null
    ) {

        return (
            health >
            0
        );
    }


    return true;
}


// ============================================================
// POSITION VALIDITY
// ============================================================

function extractPositionValidForMovement(
    row
) {

    if (
        typeof row
            ?.pawn
            ?.positionValidForMovement ===
        'boolean'
    ) {

        return row
            .pawn
            .positionValidForMovement;
    }


    // If an older file lacks the explicit field, use alive as
    // the conservative fallback.
    return extractAlive(
        row
    );
}


// ============================================================
// PLAYER WORLD POSITION
// ============================================================

function extractWorldPosition(
    row
) {

    // ========================================================
    // CURRENT CANONICAL FORMAT
    // ========================================================

    const canonical =
        normalizePosition(
            row
                ?.pawn
                ?.positionWorld
        );


    if (
        canonical
    ) {

        return canonical;
    }


    // ========================================================
    // FALLBACK: NESTED RAW CELL/VECTOR FORMAT
    // ========================================================

    const raw =
        row
            ?.pawn
            ?.positionRaw;


    if (
        raw
        &&
        typeof raw ===
        'object'
    ) {

        const converted =
            convertCellPosition(
                raw
            );


        if (
            converted
        ) {

            return converted;
        }
    }


    // ========================================================
    // LEGACY FALLBACKS
    // ========================================================

    const directCandidates =
        [

            row.worldPosition,

            row.positionWorld,

            row
                ?.position
                ?.worldPosition,

            row
                ?.position
                ?.world,

            (
                row.position
                &&
                row.position.x !==
                    undefined
            )
                ? row.position
                : null
        ];


    for (
        const candidate
        of directCandidates
    ) {

        const normalized =
            normalizePosition(
                candidate
            );


        if (
            normalized
        ) {

            return normalized;
        }
    }


    return null;
}


// ============================================================
// RAW CELL → WORLD
// ============================================================

function convertCellPosition(
    raw
) {

    const cellX =
        finite(
            raw.cellX
        );


    const cellY =
        finite(
            raw.cellY
        );


    const cellZ =
        finite(
            raw.cellZ
        );


    const vecX =
        finite(
            raw.vecX
        );


    const vecY =
        finite(
            raw.vecY
        );


    const vecZ =
        finite(
            raw.vecZ
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
            (
                cellZ !==
                    null
                &&
                vecZ !==
                    null
            )

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


// ============================================================
// OPTIONAL MELEE SUMMARY
// ============================================================

async function loadMeleeSummary(
    path
) {

    const output =
        {

            source:
                {

                    found:
                        Boolean(
                            path
                        ),

                    path
                },

            total:
                0,

            byPlayer:
                {}
        };


    if (
        !path
    ) {

        return output;
    }


    const reader =
        readline.createInterface({

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
            extractMeleePlayerName(
                row
            );


        if (
            !playerName
        ) {

            continue;
        }


        const attackType =
            String(
                row.attack_type
                ??
                row.attackType
                ??
                row.type
                ??
                'UNKNOWN'
            );


        const hit =
            extractMeleeHit(
                row
            );


        if (
            !output.byPlayer[
                playerName
            ]
        ) {

            output.byPlayer[
                playerName
            ] =
                emptyMeleeSummary();
        }


        const summary =
            output.byPlayer[
                playerName
            ];


        summary.total++;


        incrementObjectCount(
            summary.byType,
            attackType
        );


        if (
            hit ===
            true
        ) {

            summary.confirmedHits++;
        }


        output.total++;
    }


    for (
        const summary
        of Object.values(
            output.byPlayer
        )
    ) {

        summary.hitRate =
            rate(
                summary.confirmedHits,
                summary.total
            );
    }


    return output;
}


// ============================================================
// MELEE PLAYER
// ============================================================

function extractMeleePlayerName(
    row
) {

    const candidates =
        [

            row.playerName,

            row
                ?.player
                ?.playerName,

            row
                ?.player
                ?.name,

            (
                typeof row.player ===
                'string'
            )
                ? row.player
                : null
        ];


    for (
        const candidate
        of candidates
    ) {

        if (
            typeof candidate ===
            'string'
            &&
            candidate.trim()
        ) {

            return candidate.trim();
        }
    }


    return null;
}


// ============================================================
// MELEE HIT
// ============================================================

function extractMeleeHit(
    row
) {

    if (
        typeof row.hit ===
        'boolean'
    ) {

        return row.hit;
    }


    if (
        typeof row.confirmedHit ===
        'boolean'
    ) {

        return row.confirmedHit;
    }


    if (
        typeof row
            ?.hit
            ?.confirmed ===
        'boolean'
    ) {

        return row.hit.confirmed;
    }


    return null;
}


// ============================================================
// EMPTY MELEE SUMMARY
// ============================================================

function emptyMeleeSummary() {

    return {

        total:
            0,

        confirmedHits:
            0,

        hitRate:
            null,

        byType:
            {}
    };
}


// ============================================================
// EMPTY BREAKABLE ACTION SUMMARY
// ============================================================

function emptyBreakableActionSummary() {

    return {

        totalKnownBreaks:
            0,

        crates:
            0,

        statues:
            0,

        meleeBreaks:
            0,

        bulletBreaks:
            0,

        rewardDropsProduced:
            0,

        crateSoulDropsProduced:
            0,

        crateSoulsProduced:
            0,

        statueModifiersProduced:
            0
    };
}


// ============================================================
// NORMALIZE CAMP TIER
// ============================================================

function normalizeCampTier(
    value
) {

    if (
        value ===
        null
        ||
        value ===
        undefined
    ) {

        return 'UNKNOWN';
    }


    const upper =
        String(
            value
        )
        .trim()
        .toUpperCase();


    if (
        upper ===
        'SMALL'
        ||
        upper ===
        'MEDIUM'
        ||
        upper ===
        'LARGE'
    ) {

        return upper;
    }


    return upper
    ||
    'UNKNOWN';
}


// ============================================================
// POSITION
// ============================================================

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


// ============================================================
// DISTANCES
// ============================================================

function distanceXY(
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
        dx *
        dx
        +
        dy *
        dy
    );
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
        );


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


function verticalDistance(
    a,
    b
) {

    return Math.abs(
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


// ============================================================
// OBJECT COUNT
// ============================================================

function incrementObjectCount(
    object,
    key
) {

    const stringKey =
        String(
            key
            ??
            'UNKNOWN'
        );


    object[
        stringKey
    ] =
        (
            object[
                stringKey
            ]
            ??
            0
        )
        +
        1;
}


// ============================================================
// FIRST EXISTING PATH
// ============================================================

function firstExistingPath(
    paths
) {

    for (
        const path
        of paths
    ) {

        if (
            existsSync(
                path
            )
        ) {

            return path;
        }
    }


    return null;
}


// ============================================================
// CLOSE WRITE STREAM
// ============================================================

function closeWriteStream(
    stream
) {

    return new Promise(
        (
            resolvePromise,
            rejectPromise
        ) => {

            stream.on(
                'error',
                rejectPromise
            );


            stream.end(
                resolvePromise
            );
        }
    );
}


// ============================================================
// NUMBER
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


// ============================================================
// SERIALIZE
// ============================================================

function serialize(
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
        typeof value ===
        'string'
        ||
        typeof value ===
        'number'
        ||
        typeof value ===
        'boolean'
    ) {

        return value;
    }


    return String(
        value
    );
}


// ============================================================
// RATE
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
        denominator ===
            0
    ) {

        return null;
    }


    return (
        numerator /
        denominator
    );
}


// ============================================================
// CLOCK
// ============================================================

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


    return (
        negative
            ? '-'
            : ''
    )
    +
    `${minutes}:${
        String(
            secs
        ).padStart(
            2,
            '0'
        )
    }`;
}