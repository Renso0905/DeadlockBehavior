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


// ------------------------------------------------------------
// CANONICAL BULLET CRITERION
//
// Chosen empirically from Script 34:
//
// ±4 ticks / <=64 world units
//
// Results:
//
// non-melee:
//     206 / 739 matched
//     202 unique player
//       4 multiple players
//
// known melee:
//       0 / 522 matched
//
// At 96 units, false matches begin appearing in the known
// melee comparison group.
//
// Therefore 64 is the conservative boundary.
// ------------------------------------------------------------

const BULLET_TICK_WINDOW =
    4;


const BULLET_RAY_ERROR =
    64;


const RANGE_TOLERANCE =
    256;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const geometryPath =
    resolve(
        'output',
        replayName,
        'breakable_bullet_geometry_validation.json'
    );


const meleePath =
    resolve(
        'output',
        replayName,
        'verified_melee_events.jsonl'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_action_attribution_v1.json'
    );


// ============================================================
// REQUIRE FILES
// ============================================================

for (
    const path
    of [
        replayPath,
        geometryPath,
        meleePath
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
// LOAD SCRIPT 34
// ============================================================

const geometryData =
    JSON.parse(
        readFileSync(
            geometryPath,
            'utf8'
        )
    );


const sourceBreakRows =
    Array.isArray(
        geometryData.breakRows
    )
        ? geometryData.breakRows
        : [];


if (
    sourceBreakRows.length ===
    0
) {

    throw new Error(
        'Script 34 contains no breakRows.'
    );
}


const matchClockOffsetSeconds =
    toFiniteNumber(
        geometryData
            ?.constants
            ?.matchClockOffsetSeconds
    )
    ??
    30;


// ============================================================
// EXPECTED SCRIPT 34 VALIDATION
// ============================================================

const expectedThresholdRow =
    (
        geometryData
            ?.bulletGeometry
            ?.thresholdMatrix
        ??
        []
    )
    .find(
        row =>
            row.tickWindow ===
                BULLET_TICK_WINDOW
            &&
            row.rayThreshold ===
                BULLET_RAY_ERROR
    )
    ??
    null;


const expectedNonMeleeBulletMatches =
    toFiniteNumber(
        expectedThresholdRow
            ?.breaksWithoutHighConfidenceMelee
            ?.breaksWithCandidate
    );


const expectedUniqueBulletPlayers =
    toFiniteNumber(
        expectedThresholdRow
            ?.breaksWithoutHighConfidenceMelee
            ?.uniquePlayerBreaks
    );


const expectedAmbiguousBulletPlayers =
    toFiniteNumber(
        expectedThresholdRow
            ?.breaksWithoutHighConfidenceMelee
            ?.multiplePlayerBreaks
    );


const expectedMeleeFalseBulletMatches =
    toFiniteNumber(
        expectedThresholdRow
            ?.highConfidenceMeleeBreaks
            ?.breaksWithCandidate
    );


// ============================================================
// NORMALIZE BREAKS
// ============================================================

const breaks =
    sourceBreakRows

        .map(
            row => ({

                breakKey:
                    row.breakKey,

                entityIndex:
                    toFiniteNumber(
                        row.entityIndex
                    ),

                resourceType:
                    row.resourceType
                    ??
                    'UNKNOWN',

                subclassId:
                    row.subclassId
                    ??
                    null,

                breakTick:
                    toFiniteNumber(
                        row.breakTick
                    ),

                breakMatchTimeSeconds:
                    toFiniteNumber(
                        row.breakMatchTimeSeconds
                    ),

                breakClock:
                    row.breakClock
                    ??
                    null,

                position:
                    normalizePosition(
                        row.position
                    ),

                targetPoint:
                    normalizePosition(
                        row.targetPoint
                    )
                    ??
                    normalizePosition(
                        row.position
                    ),

                targetPointSource:
                    row.targetPointSource
                    ??
                    (
                        row.targetPoint
                            ? 'DEBRIS_DAMAGE_POS'
                            : 'BREAKABLE_CENTER'
                    ),

                debris:
                    row.debris
                    ??
                    null,

                rewardObserved:
                    row.rewardObserved ===
                    true,

                reward:
                    row.reward
                    ??
                    null,

                highConfidenceMelee:
                    row.highConfidenceMelee ===
                    true,

                meleeCandidate:
                    row.script33MeleeCandidate
                    ??
                    null
            })
        )

        .filter(
            row =>
                row.breakKey
                &&
                row.entityIndex !==
                    null
                &&
                row.breakTick !==
                    null
                &&
                row.targetPoint
        )

        .sort(
            (
                a,
                b
            ) =>
                a.breakTick -
                b.breakTick
        );


if (
    breaks.length !==
    sourceBreakRows.length
) {

    console.warn(
        `Warning: normalized ${
            breaks.length
        }/${
            sourceBreakRows.length
        } break rows.`
    );
}


// ============================================================
// PLAYER IDENTITY
//
// Build stable player pawn/controller mappings from our
// authoritative direct-melee dataset.
// ============================================================

const playerByPawnIndex =
    new Map();


const playerByControllerIndex =
    new Map();


const meleeText =
    readFileSync(
        meleePath,
        'utf8'
    );


for (
    const line
    of meleeText.split(
        /\r?\n/
    )
) {

    const trimmed =
        line.trim();


    if (
        !trimmed
    ) {

        continue;
    }


    let row;


    try {

        row =
            JSON.parse(
                trimmed
            );

    } catch {

        continue;
    }


    const pawnEntityIndex =
        toFiniteNumber(
            row.pawnEntityIndex
        );


    const controllerEntityIndex =
        toFiniteNumber(
            row.controllerEntityIndex
        );


    const identity =
        {

            playerName:
                row.playerName
                ??
                null,

            heroId:
                toFiniteNumber(
                    row.heroId
                ),

            team:
                toFiniteNumber(
                    row.team
                ),

            pawnEntityIndex,

            controllerEntityIndex
        };


    if (
        pawnEntityIndex !==
        null
    ) {

        playerByPawnIndex.set(
            pawnEntityIndex,
            identity
        );
    }


    if (
        controllerEntityIndex !==
        null
    ) {

        playerByControllerIndex.set(
            controllerEntityIndex,
            identity
        );
    }
}


// ============================================================
// BREAK WINDOW TICKS
// ============================================================

const relevantFireTicks =
    new Set();


for (
    const breakEvent
    of breaks
) {

    for (
        let delta =
            -BULLET_TICK_WINDOW;

        delta <=
            BULLET_TICK_WINDOW;

        delta++
    ) {

        relevantFireTicks.add(
            breakEvent.breakTick +
            delta
        );
    }
}


// ============================================================
// FIRE EVENTS
// ============================================================

const fireEventsByTick =
    new Map();


let totalFireBulletMessages =
    0;


let relevantFireBulletMessages =
    0;


let relevantPlayerFireBulletMessages =
    0;


let relevantNonPlayerFireBulletMessages =
    0;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const typeCode =
            getMessageTypeCode(
                messagePacket
            );


        if (
            typeCode !==
            'GE_FireBullets'
        ) {

            return;
        }


        totalFireBulletMessages++;


        const tick =
            toFiniteNumber(
                demoPacket.tick
            );


        if (
            tick ===
            null
            ||
            !relevantFireTicks.has(
                tick
            )
        ) {

            return;
        }


        relevantFireBulletMessages++;


        const data =
            messagePacket.data
            ??
            {};


        const shooterEntity =
            toFiniteNumber(
                data.shooterEntity
            );


        const player =
            resolveShooterPlayer(
                shooterEntity
            );


        if (
            player
        ) {

            relevantPlayerFireBulletMessages++;

        } else {

            relevantNonPlayerFireBulletMessages++;
        }


        const event =
            {

                fireKey:
                    makeFireKey(
                        tick,
                        shooterEntity,
                        data.shotId,
                        data.shotNumber
                    ),

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                shooterEntity,

                player,

                origin:
                    normalizePosition(
                        data.origin
                    ),

                angles:
                    normalizeAngles(
                        data.angles
                    ),

                anglesOriginal:
                    normalizeAngles(
                        data.anglesOriginal
                    ),

                maxRange:
                    toFiniteNumber(
                        data.maxRange
                    ),

                spread:
                    toFiniteNumber(
                        data.spread
                    ),

                penetrationPercent:
                    toFiniteNumber(
                        data.penetrationPercent
                    ),

                abilityEntityIndex:
                    toFiniteNumber(
                        data.ability
                    ),

                weaponSubclassId:
                    serializeValue(
                        data.weaponSubclassId
                    ),

                shotId:
                    serializeValue(
                        data.shotId
                    ),

                shotNumber:
                    toFiniteNumber(
                        data.shotNumber
                    ),

                tracerAdditionalCount:
                    Array.isArray(
                        data.tracerAdditional
                    )

                        ? data
                            .tracerAdditional
                            .length

                        : 0
            };


        if (
            !fireEventsByTick.has(
                tick
            )
        ) {

            fireEventsByTick.set(
                tick,
                []
            );
        }


        fireEventsByTick
            .get(
                tick
            )
            .push(
                event
            );
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '===================================='
);

console.log(
    'BREAKABLE ACTION ATTRIBUTION V1'
);

console.log(
    '===================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Breaks: ${breaks.length}`
);

console.log(
    `Known players: ${playerByPawnIndex.size}`
);

console.log('');

console.log(
    'Canonical hierarchy:'
);

console.log(
    '1. Direct melee'
);

console.log(
    '2. Unique player bullet ray'
);

console.log(
    '3. Ambiguous bullet ray'
);

console.log(
    '4. Unattributed'
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// ATTRIBUTION
// ============================================================

const attributionRows =
    [];


for (
    const breakEvent
    of breaks
) {

    // ========================================================
    // DIRECT MELEE
    // ========================================================

    if (
        breakEvent.highConfidenceMelee
        &&
        breakEvent.meleeCandidate
    ) {

        const melee =
            breakEvent.meleeCandidate;


        attributionRows.push({

            ...baseBreakFields(
                breakEvent
            ),

            attributionStatus:
                'ATTRIBUTED',

            attributionMethod:
                'MELEE_DIRECT',

            confidence:
                'HIGH',

            player:
                {

                    playerName:
                        melee.playerName
                        ??
                        null,

                    heroId:
                        toFiniteNumber(
                            melee.heroId
                        ),

                    team:
                        toFiniteNumber(
                            melee.team
                        ),

                    pawnEntityIndex:
                        toFiniteNumber(
                            melee.pawnEntityIndex
                        ),

                    controllerEntityIndex:
                        toFiniteNumber(
                            melee.controllerEntityIndex
                        )
                },

            meleeEvidence:
                {

                    attackType:
                        melee.attackType
                        ??
                        null,

                    attackTypeCode:
                        toFiniteNumber(
                            melee.attackTypeCode
                        ),

                    attackTick:
                        toFiniteNumber(
                            melee.attackTick
                        ),

                    attackMatchTimeSeconds:
                        toFiniteNumber(
                            melee.attackMatchTimeSeconds
                        ),

                    attackPosition:
                        normalizePosition(
                            melee.attackPosition
                        ),

                    hit:
                        melee.hit ===
                        true,

                    tickDelta:
                        toFiniteNumber(
                            melee.tickDelta
                        ),

                    timeDeltaSeconds:
                        toFiniteNumber(
                            melee.timeDeltaSeconds
                        ),

                    distance:
                        toFiniteNumber(
                            melee.distance
                        )
                },

            bulletEvidence:
                null
        });


        continue;
    }


    // ========================================================
    // PLAYER BULLET CANDIDATES
    // ========================================================

    const bulletCandidates =
        findCanonicalPlayerBulletCandidates(
            breakEvent
        );


    const players =
        uniqueCandidatePlayers(
            bulletCandidates
        );


    // ========================================================
    // UNIQUE BULLET PLAYER
    // ========================================================

    if (
        players.length ===
        1
    ) {

        const player =
            players[0];


        const samePlayerCandidates =
            bulletCandidates

                .filter(
                    candidate =>
                        samePlayer(
                            candidate.player,
                            player
                        )
                )

                .sort(
                    bulletCandidateSort
                );


        const best =
            samePlayerCandidates[0];


        attributionRows.push({

            ...baseBreakFields(
                breakEvent
            ),

            attributionStatus:
                'ATTRIBUTED',

            attributionMethod:
                'BULLET_RAY',

            confidence:
                'HIGH_GEOMETRIC',

            player,

            meleeEvidence:
                null,

            bulletEvidence:
                {

                    criterion:
                        {

                            maxAbsoluteTickDelta:
                                BULLET_TICK_WINDOW,

                            maxAbsoluteTimeDeltaSeconds:
                                BULLET_TICK_WINDOW /
                                TICK_RATE,

                            maxRayError:
                                BULLET_RAY_ERROR
                        },

                    candidateCount:
                        bulletCandidates.length,

                    candidatePlayerCount:
                        1,

                    bestCandidate:
                        best,

                    samePlayerCandidates:
                        samePlayerCandidates
                }
        });


        continue;
    }


    // ========================================================
    // MULTIPLE BULLET PLAYERS
    // ========================================================

    if (
        players.length >
        1
    ) {

        attributionRows.push({

            ...baseBreakFields(
                breakEvent
            ),

            attributionStatus:
                'AMBIGUOUS',

            attributionMethod:
                'BULLET_RAY_MULTIPLE_PLAYERS',

            confidence:
                'UNRESOLVED',

            player:
                null,

            meleeEvidence:
                null,

            bulletEvidence:
                {

                    criterion:
                        {

                            maxAbsoluteTickDelta:
                                BULLET_TICK_WINDOW,

                            maxAbsoluteTimeDeltaSeconds:
                                BULLET_TICK_WINDOW /
                                TICK_RATE,

                            maxRayError:
                                BULLET_RAY_ERROR
                        },

                    candidateCount:
                        bulletCandidates.length,

                    candidatePlayerCount:
                        players.length,

                    candidatePlayers:
                        players,

                    candidates:
                        bulletCandidates
                }
        });


        continue;
    }


    // ========================================================
    // NO PLAYER ACTION YET
    // ========================================================

    attributionRows.push({

        ...baseBreakFields(
            breakEvent
        ),

        attributionStatus:
            'UNATTRIBUTED',

        attributionMethod:
            'NONE_V1',

        confidence:
            'UNKNOWN',

        player:
            null,

        meleeEvidence:
            null,

        bulletEvidence:
            null
    });
}


// ============================================================
// COUNTS
// ============================================================

const meleeAttributed =
    attributionRows.filter(
        row =>
            row.attributionMethod ===
            'MELEE_DIRECT'
    );


const bulletAttributed =
    attributionRows.filter(
        row =>
            row.attributionMethod ===
            'BULLET_RAY'
    );


const ambiguousBullet =
    attributionRows.filter(
        row =>
            row.attributionMethod ===
            'BULLET_RAY_MULTIPLE_PLAYERS'
    );


const unattributed =
    attributionRows.filter(
        row =>
            row.attributionMethod ===
            'NONE_V1'
    );


const attributed =
    attributionRows.filter(
        row =>
            row.attributionStatus ===
            'ATTRIBUTED'
    );


// ============================================================
// RESOURCE-TYPE SUMMARY
// ============================================================

const resourceTypeSummary =
    [];


for (
    const resourceType
    of [
        'CRATE',
        'GOLDEN_STATUE'
    ]
) {

    const rows =
        attributionRows.filter(
            row =>
                row.resourceType ===
                resourceType
        );


    const resourceAttributed =
        rows.filter(
            row =>
                row.attributionStatus ===
                'ATTRIBUTED'
        );


    const rewardDrops =
        rows.filter(
            row =>
                row.rewardOutcome
                    ?.dropped ===
                true
        );


    resourceTypeSummary.push({

        resourceType,

        breaks:
            rows.length,

        attributed:
            resourceAttributed.length,

        attributionRate:
            rate(
                resourceAttributed.length,
                rows.length
            ),

        meleeAttributed:
            rows.filter(
                row =>
                    row.attributionMethod ===
                    'MELEE_DIRECT'
            ).length,

        bulletAttributed:
            rows.filter(
                row =>
                    row.attributionMethod ===
                    'BULLET_RAY'
            ).length,

        ambiguousBullet:
            rows.filter(
                row =>
                    row.attributionMethod ===
                    'BULLET_RAY_MULTIPLE_PLAYERS'
            ).length,

        unattributed:
            rows.filter(
                row =>
                    row.attributionMethod ===
                    'NONE_V1'
            ).length,

        rewardDrops:
            rewardDrops.length,

        noRewardDrops:
            rows.length -
            rewardDrops.length,

        observedRewardRate:
            rate(
                rewardDrops.length,
                rows.length
            )
    });
}


// ============================================================
// PLAYER SUMMARY
// ============================================================

const attributedByPlayer =
    new Map();


for (
    const row
    of attributed
) {

    const playerName =
        row
            .player
            ?.playerName
        ??
        'UNKNOWN';


    if (
        !attributedByPlayer.has(
            playerName
        )
    ) {

        attributedByPlayer.set(
            playerName,
            []
        );
    }


    attributedByPlayer
        .get(
            playerName
        )
        .push(
            row
        );
}


const playerSummaries =
    [];


for (
    const [
        playerName,
        rows
    ]
    of attributedByPlayer
) {

    const identity =
        rows[0]
            ?.player
        ??
        null;


    const crateRows =
        rows.filter(
            row =>
                row.resourceType ===
                'CRATE'
        );


    const statueRows =
        rows.filter(
            row =>
                row.resourceType ===
                'GOLDEN_STATUE'
        );


    const rewardRows =
        rows.filter(
            row =>
                row.rewardOutcome
                    ?.dropped ===
                true
        );


    const soulDrops =
        rewardRows.filter(
            row =>
                row.rewardOutcome
                    ?.rewardType ===
                'SOULS'
        );


    const modifierDrops =
        rewardRows.filter(
            row =>
                row.rewardOutcome
                    ?.rewardType ===
                'PERMANENT_MODIFIER'
        );


    const realizedBoxSouls =
        soulDrops.reduce(
            (
                total,
                row
            ) =>
                total +
                (
                    toFiniteNumber(
                        row
                            .rewardOutcome
                            ?.goldReward
                    )
                    ??
                    0
                ),
            0
        );


    playerSummaries.push({

        playerName,

        heroId:
            identity
                ?.heroId
            ??
            null,

        team:
            identity
                ?.team
            ??
            null,

        pawnEntityIndex:
            identity
                ?.pawnEntityIndex
            ??
            null,

        controllerEntityIndex:
            identity
                ?.controllerEntityIndex
            ??
            null,

        attributedBreaks:
            rows.length,

        meleeBreaks:
            rows.filter(
                row =>
                    row.attributionMethod ===
                    'MELEE_DIRECT'
            ).length,

        bulletBreaks:
            rows.filter(
                row =>
                    row.attributionMethod ===
                    'BULLET_RAY'
            ).length,

        cratesBroken:
            crateRows.length,

        statuesBroken:
            statueRows.length,

        rewardDrops:
            rewardRows.length,

        noRewardDrops:
            rows.length -
            rewardRows.length,

        crateSoulDrops:
            soulDrops.length,

        realizedBoxSouls,

        statueModifierDrops:
            modifierDrops.length,

        modifierSubclassIds:
            countBy(
                modifierDrops,
                row =>
                    row
                        .rewardOutcome
                        ?.modifierSubclassId
                    ??
                    'UNKNOWN'
            )
    });
}


playerSummaries.sort(
    (
        a,
        b
    ) =>
        b.attributedBreaks -
        a.attributedBreaks
);


// ============================================================
// METHOD SUMMARY
// ============================================================

const methodSummary =
    countBy(
        attributionRows,
        row =>
            row.attributionMethod
    );


// ============================================================
// REWARD SUMMARY
// ============================================================

const rewardSummary =
    {

        totalBreaks:
            attributionRows.length,

        drops:
            attributionRows.filter(
                row =>
                    row.rewardOutcome
                        ?.dropped ===
                    true
            ).length,

        noDrops:
            attributionRows.filter(
                row =>
                    row.rewardOutcome
                        ?.dropped ===
                    false
            ).length,

        crateSoulDrops:
            attributionRows.filter(
                row =>
                    row.rewardOutcome
                        ?.rewardType ===
                    'SOULS'
            ).length,

        statueModifierDrops:
            attributionRows.filter(
                row =>
                    row.rewardOutcome
                        ?.rewardType ===
                    'PERMANENT_MODIFIER'
            ).length
    };


// ============================================================
// VALIDATION
// ============================================================

const rebuiltBulletCandidateBreaks =
    bulletAttributed.length +
    ambiguousBullet.length;


const validation =
    {

        totalBreakCount:
            {

                expected:
                    toFiniteNumber(
                        geometryData
                            ?.sourceCounts
                            ?.totalBreaks
                    )
                    ??
                    breaks.length,

                observed:
                    attributionRows.length,

                pass:
                    (
                        toFiniteNumber(
                            geometryData
                                ?.sourceCounts
                                ?.totalBreaks
                        )
                        ??
                        breaks.length
                    )
                    ===
                    attributionRows.length
            },

        meleeAttributed:
            {

                expected:
                    toFiniteNumber(
                        geometryData
                            ?.sourceCounts
                            ?.highConfidenceMeleeBreaks
                    ),

                observed:
                    meleeAttributed.length,

                pass:
                    expectedMatches(
                        toFiniteNumber(
                            geometryData
                                ?.sourceCounts
                                ?.highConfidenceMeleeBreaks
                        ),
                        meleeAttributed.length
                    )
            },

        bulletCandidateBreaks:
            {

                expected:
                    expectedNonMeleeBulletMatches,

                observed:
                    rebuiltBulletCandidateBreaks,

                pass:
                    expectedMatches(
                        expectedNonMeleeBulletMatches,
                        rebuiltBulletCandidateBreaks
                    )
            },

        uniqueBulletPlayerBreaks:
            {

                expected:
                    expectedUniqueBulletPlayers,

                observed:
                    bulletAttributed.length,

                pass:
                    expectedMatches(
                        expectedUniqueBulletPlayers,
                        bulletAttributed.length
                    )
            },

        ambiguousBulletPlayerBreaks:
            {

                expected:
                    expectedAmbiguousBulletPlayers,

                observed:
                    ambiguousBullet.length,

                pass:
                    expectedMatches(
                        expectedAmbiguousBulletPlayers,
                        ambiguousBullet.length
                    )
            },

        meleeControlFalseBulletMatches:
            {

                expected:
                    expectedMeleeFalseBulletMatches,

                canonicalCriterion:
                    {

                        tickWindow:
                            BULLET_TICK_WINDOW,

                        rayError:
                            BULLET_RAY_ERROR
                    }
            }
    };


const validationPass =
    Object.values(
        validation
    )
    .every(
        row =>
            row.pass !==
                false
    );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        version:
            'BREAKABLE_ACTION_ATTRIBUTION_V1',

        canonical:
            {

                scope:
                    'Player attribution from direct melee and player bullet-ray geometry only.',

                hierarchy:
                    [

                        'MELEE_DIRECT',

                        'BULLET_RAY',

                        'BULLET_RAY_MULTIPLE_PLAYERS',

                        'NONE_V1'
                    ],

                bulletCriterion:
                    {

                        maxAbsoluteTickDelta:
                            BULLET_TICK_WINDOW,

                        maxAbsoluteTimeDeltaSeconds:
                            BULLET_TICK_WINDOW /
                            TICK_RATE,

                        maxPerpendicularRayError:
                            BULLET_RAY_ERROR,

                        rangeTolerance:
                            RANGE_TOLERANCE
                    },

                bulletCriterionRationale:
                    {

                        nonMeleeMatches:
                            expectedNonMeleeBulletMatches,

                        uniquePlayerMatches:
                            expectedUniqueBulletPlayers,

                        multiplePlayerMatches:
                            expectedAmbiguousBulletPlayers,

                        knownMeleeFalseMatches:
                            expectedMeleeFalseBulletMatches,

                        note:
                            '64 units is the largest tested threshold before known-melee control contamination begins at 96 units.'
                    },

                importantLimitations:
                    [

                        'V1 does not yet attribute ability/AOE/environmental/non-player destruction.',

                        'Ambiguous bullet events are intentionally not forced to a player.',

                        'No nearest-player fallback is used.',

                        'Break occurrence and reward outcome are separate variables because crates/statues do not always produce a reward.'
                    ]
            },

        sourceCounts:
            {

                totalBreaks:
                    breaks.length,

                totalFireBulletMessages,

                relevantFireBulletMessages,

                relevantPlayerFireBulletMessages,

                relevantNonPlayerFireBulletMessages,

                knownPlayerPawns:
                    playerByPawnIndex.size,

                knownPlayerControllers:
                    playerByControllerIndex.size
            },

        attributionSummary:
            {

                totalBreaks:
                    attributionRows.length,

                attributed:
                    attributed.length,

                attributionRate:
                    rate(
                        attributed.length,
                        attributionRows.length
                    ),

                meleeAttributed:
                    meleeAttributed.length,

                meleeRate:
                    rate(
                        meleeAttributed.length,
                        attributionRows.length
                    ),

                bulletAttributed:
                    bulletAttributed.length,

                bulletRate:
                    rate(
                        bulletAttributed.length,
                        attributionRows.length
                    ),

                ambiguousBullet:
                    ambiguousBullet.length,

                unattributed:
                    unattributed.length,

                unresolvedTotal:
                    ambiguousBullet.length +
                    unattributed.length,

                unresolvedRate:
                    rate(
                        ambiguousBullet.length +
                        unattributed.length,
                        attributionRows.length
                    )
            },

        methodSummary,

        rewardSummary,

        resourceTypeSummary,

        playerSummaries,

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        ambiguousBulletRows:
            ambiguousBullet,

        unattributedRows:
            unattributed,

        attributionRows
    };


// ============================================================
// WRITE
// ============================================================

mkdirSync(
    dirname(
        outputPath
    ),
    {
        recursive: true
    }
);


writeFileSync(

    outputPath,

    JSON.stringify(
        output,
        null,
        2
    ),

    'utf8'
);


// ============================================================
// CONSOLE SUMMARY
// ============================================================

console.log(
    'CANONICAL BULLET CRITERION'
);

console.log(
    '--------------------------'
);

console.log(
    `Tick window: ±${BULLET_TICK_WINDOW} ticks (${
        (
            BULLET_TICK_WINDOW /
            TICK_RATE
        ).toFixed(
            4
        )
    }s)`
);

console.log(
    `Ray error: <=${BULLET_RAY_ERROR}`
);

console.log('');


console.log(
    'ATTRIBUTION'
);

console.log(
    '-----------'
);

console.log(
    `Total breaks: ${attributionRows.length}`
);

console.log(
    `Direct melee: ${meleeAttributed.length}`
);

console.log(
    `Unique bullet ray: ${bulletAttributed.length}`
);

console.log(
    `Attributed total: ${
        attributed.length
    }/${
        attributionRows.length
    } = ${
        formatPercent(
            rate(
                attributed.length,
                attributionRows.length
            )
        )
    }`
);

console.log(
    `Ambiguous bullet: ${ambiguousBullet.length}`
);

console.log(
    `No V1 attribution: ${unattributed.length}`
);

console.log(
    `Remaining unresolved: ${
        ambiguousBullet.length +
        unattributed.length
    }`
);

console.log('');


console.log(
    'REWARD OUTCOMES'
);

console.log(
    '---------------'
);

console.log(
    `Reward drops: ${rewardSummary.drops}`
);

console.log(
    `No drop: ${rewardSummary.noDrops}`
);

console.log(
    `Crate soul drops: ${rewardSummary.crateSoulDrops}`
);

console.log(
    `Statue modifier drops: ${rewardSummary.statueModifierDrops}`
);

console.log('');


console.log(
    'PER PLAYER'
);

console.log(
    '----------'
);


for (
    const row
    of playerSummaries
) {

    console.log(
        `${
            String(
                row.playerName
            ).padEnd(
                28
            )
        } breaks=${
            String(
                row.attributedBreaks
            ).padStart(
                4
            )
        } melee=${
            String(
                row.meleeBreaks
            ).padStart(
                4
            )
        } bullet=${
            String(
                row.bulletBreaks
            ).padStart(
                4
            )
        } crates=${
            String(
                row.cratesBroken
            ).padStart(
                4
            )
        } statues=${
            String(
                row.statuesBroken
            ).padStart(
                3
            )
        } souls=${
            String(
                row.realizedBoxSouls
            ).padStart(
                5
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

console.log(
    `Overall: ${
        validationPass
            ? 'PASS'
            : 'FAIL'
    }`
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

    if (
        row.pass ===
        undefined
    ) {

        continue;
    }


    console.log(
        `${
            key.padEnd(
                32
            )
        } ${
            row.pass
                ? 'PASS'
                : 'FAIL'
        } expected=${
            row.expected
            ??
            'n/a'
        } observed=${
            row.observed
            ??
            'n/a'
        }`
    );
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// FIND CANONICAL PLAYER BULLETS
// ============================================================

function findCanonicalPlayerBulletCandidates(
    breakEvent
) {

    const candidates =
        [];


    for (
        let tick =
            breakEvent.breakTick -
            BULLET_TICK_WINDOW;

        tick <=
            breakEvent.breakTick +
            BULLET_TICK_WINDOW;

        tick++
    ) {

        const shots =
            fireEventsByTick.get(
                tick
            )
            ??
            [];


        for (
            const shot
            of shots
        ) {

            if (
                !shot.player
                ||
                !shot.origin
                ||
                !shot.angles
            ) {

                continue;
            }


            const geometry =
                rayPointGeometry(
                    shot.origin,
                    shot.angles,
                    breakEvent.targetPoint
                );


            if (
                !geometry
            ) {

                continue;
            }


            const maxRange =
                shot.maxRange
                ??
                7000;


            if (
                geometry.alongRayDistance <
                    -32
                ||
                geometry.alongRayDistance >
                    maxRange +
                    RANGE_TOLERANCE
            ) {

                continue;
            }


            if (
                geometry.perpendicularDistance >
                BULLET_RAY_ERROR
            ) {

                continue;
            }


            const tickDelta =
                shot.tick -
                breakEvent.breakTick;


            const score =
                bulletCandidateScore(
                    tickDelta,
                    geometry.perpendicularDistance
                );


            candidates.push({

                fireKey:
                    shot.fireKey,

                fireTick:
                    shot.tick,

                fireMatchTimeSeconds:
                    shot.matchTimeSeconds,

                tickDelta,

                timeDeltaSeconds:
                    tickDelta /
                    TICK_RATE,

                player:
                    shot.player,

                shooterEntity:
                    shot.shooterEntity,

                shotId:
                    shot.shotId,

                shotNumber:
                    shot.shotNumber,

                weaponSubclassId:
                    shot.weaponSubclassId,

                abilityEntityIndex:
                    shot.abilityEntityIndex,

                origin:
                    shot.origin,

                angles:
                    shot.angles,

                anglesOriginal:
                    shot.anglesOriginal,

                spread:
                    shot.spread,

                penetrationPercent:
                    shot.penetrationPercent,

                maxRange,

                tracerAdditionalCount:
                    shot.tracerAdditionalCount,

                alongRayDistance:
                    geometry.alongRayDistance,

                perpendicularDistance:
                    geometry.perpendicularDistance,

                closestPointOnRay:
                    geometry.closestPoint,

                score
            });
        }
    }


    return candidates.sort(
        bulletCandidateSort
    );
}


// ============================================================
// BASE BREAK FIELDS
// ============================================================

function baseBreakFields(
    breakEvent
) {

    return {

        breakKey:
            breakEvent.breakKey,

        entityIndex:
            breakEvent.entityIndex,

        resourceType:
            breakEvent.resourceType,

        subclassId:
            breakEvent.subclassId,

        breakTick:
            breakEvent.breakTick,

        breakMatchTimeSeconds:
            breakEvent.breakMatchTimeSeconds,

        breakClock:
            breakEvent.breakClock,

        position:
            breakEvent.position,

        impactPosition:
            breakEvent.targetPoint,

        impactPositionSource:
            breakEvent.targetPointSource,

        debris:
            breakEvent.debris,

        rewardOutcome:
            buildRewardOutcome(
                breakEvent
            )
    };
}


// ============================================================
// REWARD OUTCOME
//
// Crucially:
//
//     break != reward
//
// A crate/statue can be destroyed without producing anything.
// ============================================================

function buildRewardOutcome(
    breakEvent
) {

    if (
        !breakEvent.rewardObserved
        ||
        !breakEvent.reward
    ) {

        return {

            dropped:
                false,

            rewardType:
                null,

            pickupClass:
                null,

            pickupEntityIndex:
                null,

            goldReward:
                null,

            modifierSubclassId:
                null
        };
    }


    const reward =
        breakEvent.reward;


    if (
        reward.pickupClass ===
        'CCitadel_Pickup_Gold'
    ) {

        return {

            dropped:
                true,

            rewardType:
                'SOULS',

            pickupClass:
                reward.pickupClass,

            pickupEntityIndex:
                toFiniteNumber(
                    reward.pickupEntityIndex
                ),

            goldReward:
                toFiniteNumber(
                    reward.goldReward
                ),

            modifierSubclassId:
                null
        };
    }


    if (
        reward.pickupClass ===
        'CCitadel_Pickup_Modifier'
    ) {

        return {

            dropped:
                true,

            rewardType:
                'PERMANENT_MODIFIER',

            pickupClass:
                reward.pickupClass,

            pickupEntityIndex:
                toFiniteNumber(
                    reward.pickupEntityIndex
                ),

            goldReward:
                null,

            modifierSubclassId:
                reward.modifierSubclassId
                ??
                null
        };
    }


    return {

        dropped:
            true,

        rewardType:
            'OTHER',

        pickupClass:
            reward.pickupClass
            ??
            null,

        pickupEntityIndex:
            toFiniteNumber(
                reward.pickupEntityIndex
            ),

        goldReward:
            toFiniteNumber(
                reward.goldReward
            ),

        modifierSubclassId:
            reward.modifierSubclassId
            ??
            null
    };
}


// ============================================================
// UNIQUE CANDIDATE PLAYERS
// ============================================================

function uniqueCandidatePlayers(
    candidates
) {

    const map =
        new Map();


    for (
        const candidate
        of candidates
    ) {

        const player =
            candidate.player;


        if (
            !player
        ) {

            continue;
        }


        const key =
            player.pawnEntityIndex !==
                null
                &&
                player.pawnEntityIndex !==
                    undefined

                ? `pawn:${player.pawnEntityIndex}`

                : `name:${player.playerName}`;


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                player
            );
        }
    }


    return [
        ...map.values()
    ];
}


// ============================================================
// SAME PLAYER
// ============================================================

function samePlayer(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return false;
    }


    if (
        a.pawnEntityIndex !==
            null
        &&
        a.pawnEntityIndex !==
            undefined
        &&
        b.pawnEntityIndex !==
            null
        &&
        b.pawnEntityIndex !==
            undefined
    ) {

        return (
            a.pawnEntityIndex ===
            b.pawnEntityIndex
        );
    }


    return (
        a.playerName ===
        b.playerName
    );
}


// ============================================================
// BULLET SORT
// ============================================================

function bulletCandidateSort(
    a,
    b
) {

    return (
        a.score -
        b.score
    );
}


// ============================================================
// BULLET SCORE
// ============================================================

function bulletCandidateScore(
    tickDelta,
    perpendicularDistance
) {

    let score =
        Math.abs(
            tickDelta
        )
        *
        10000;


    // A shot can appear one or more demo ticks after the
    // destruction packet because of packet/event ordering.
    //
    // We permit it, but slightly prefer prior/same-tick shots.
    if (
        tickDelta >
        0
    ) {

        score +=
            2500;
    }


    score +=
        perpendicularDistance;


    return score;
}


// ============================================================
// RAY / POINT GEOMETRY
// ============================================================

function rayPointGeometry(
    origin,
    angles,
    point
) {

    if (
        !origin
        ||
        !angles
        ||
        !point
    ) {

        return null;
    }


    const direction =
        sourceAnglesToDirection(
            angles
        );


    if (
        !direction
    ) {

        return null;
    }


    const px =
        point.x -
        origin.x;


    const py =
        point.y -
        origin.y;


    const pz =
        point.z -
        origin.z;


    const alongRayDistance =
        px *
        direction.x
        +
        py *
        direction.y
        +
        pz *
        direction.z;


    const closestPoint =
        {

            x:
                origin.x +
                direction.x *
                alongRayDistance,

            y:
                origin.y +
                direction.y *
                alongRayDistance,

            z:
                origin.z +
                direction.z *
                alongRayDistance
        };


    const perpendicularDistance =
        distance3D(
            point,
            closestPoint
        );


    return {

        direction,

        alongRayDistance,

        perpendicularDistance,

        closestPoint
    };
}


// ============================================================
// SOURCE ANGLES → UNIT DIRECTION
// ============================================================

function sourceAnglesToDirection(
    angles
) {

    const pitch =
        toFiniteNumber(
            angles.x
        );


    const yaw =
        toFiniteNumber(
            angles.y
        );


    if (
        pitch ===
        null
        ||
        yaw ===
        null
    ) {

        return null;
    }


    const pitchRadians =
        degreesToRadians(
            pitch
        );


    const yawRadians =
        degreesToRadians(
            yaw
        );


    const cosPitch =
        Math.cos(
            pitchRadians
        );


    const direction =
        {

            x:
                cosPitch *
                Math.cos(
                    yawRadians
                ),

            y:
                cosPitch *
                Math.sin(
                    yawRadians
                ),

            z:
                -Math.sin(
                    pitchRadians
                )
        };


    const length =
        Math.sqrt(
            direction.x *
            direction.x
            +
            direction.y *
            direction.y
            +
            direction.z *
            direction.z
        );


    if (
        length <=
        0
    ) {

        return null;
    }


    return {

        x:
            direction.x /
            length,

        y:
            direction.y /
            length,

        z:
            direction.z /
            length
    };
}


// ============================================================
// SHOOTER → PLAYER
// ============================================================

function resolveShooterPlayer(
    shooterEntity
) {

    if (
        shooterEntity ===
        null
    ) {

        return null;
    }


    if (
        playerByPawnIndex.has(
            shooterEntity
        )
    ) {

        return playerByPawnIndex.get(
            shooterEntity
        );
    }


    if (
        playerByControllerIndex.has(
            shooterEntity
        )
    ) {

        return playerByControllerIndex.get(
            shooterEntity
        );
    }


    return null;
}


// ============================================================
// FIRE KEY
// ============================================================

function makeFireKey(
    tick,
    shooterEntity,
    shotId,
    shotNumber
) {

    return [
        tick,
        shooterEntity
        ??
        'NULL',
        serializeValue(
            shotId
        )
        ??
        'NULL',
        shotNumber
        ??
        'NULL'
    ].join(
        '|'
    );
}


// ============================================================
// MESSAGE TYPE
// ============================================================

function getMessageTypeCode(
    messagePacket
) {

    return (
        messagePacket
            ?.type
            ?._code
        ??
        messagePacket
            ?.type
            ?.code
        ??
        null
    );
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
        toFiniteNumber(
            value.x
        );


    const y =
        toFiniteNumber(
            value.y
        );


    const z =
        toFiniteNumber(
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
            z
            ??
            0
    };
}


// ============================================================
// ANGLES
// ============================================================

function normalizeAngles(
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
        toFiniteNumber(
            value.x
        );


    const y =
        toFiniteNumber(
            value.y
        );


    const z =
        toFiniteNumber(
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
            z
            ??
            0
    };
}


// ============================================================
// DISTANCE
// ============================================================

function distance3D(
    a,
    b
) {

    if (
        !a
        ||
        !b
    ) {

        return null;
    }


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


// ============================================================
// TIME
// ============================================================

function tickToMatchTime(
    tick
) {

    return (
        tick /
        TICK_RATE
    )
    -
    matchClockOffsetSeconds;
}


// ============================================================
// DEGREES
// ============================================================

function degreesToRadians(
    value
) {

    return (
        value *
        Math.PI
        /
        180
    );
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    rows,
    selector
) {

    const map =
        new Map();


    for (
        const row
        of rows
    ) {

        const raw =
            selector(
                row
            );


        const key =
            raw ===
                null
                ||
                raw ===
                undefined

                ? 'NULL'

                : String(
                    raw
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
        [...map.entries()]
            .sort(
                (
                    a,
                    b
                ) =>
                    b[1] -
                    a[1]
            )
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
// EXPECTED MATCH
// ============================================================

function expectedMatches(
    expected,
    observed
) {

    if (
        expected ===
        null
        ||
        expected ===
        undefined
    ) {

        return true;
    }


    return (
        expected ===
        observed
    );
}


// ============================================================
// SERIALIZE
// ============================================================

function serializeValue(
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
// NUMBER
// ============================================================

function toFiniteNumber(
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
// PERCENT
// ============================================================

function formatPercent(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return 'n/a';
    }


    return (
        value *
        100
    ).toFixed(
        2
    )
    +
    '%';
}