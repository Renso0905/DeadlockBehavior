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


// Source 2 entity handles in this replay use the low 14 bits
// for the entity entry/index.
//
// Example:
//
//     targetEntity = 1901674
//     1901674 & 0x3fff = 1130
//
// which matches canonical breakable entity 1130.
const ENTITY_INDEX_MASK =
    0x3fff;


// Search shots up to ±4 demo ticks around the destruction.
//
// We are NOT declaring ±4 canonical.
// Script 34 measures how the geometry behaves at:
// 0, ±1, ±2 and ±4 ticks.
const FIRE_WINDOW_TICKS =
    4;


// We retain plausible rays out to this perpendicular error
// for diagnostic inspection.
//
// Thresholds below are much tighter.
const MAX_STORED_RAY_ERROR =
    512;


// Allow a little tolerance beyond the nominal bullet max range.
const RANGE_TOLERANCE =
    256;


// Ray-error thresholds that Script 34 evaluates.
//
// We do NOT choose the canonical threshold in advance.
const RAY_ERROR_THRESHOLDS =
    [
        16,
        32,
        48,
        64,
        96,
        128,
        192,
        256
    ];


// Tick windows evaluated independently.
const TICK_WINDOWS =
    [
        0,
        1,
        2,
        4
    ];


// For output size.
const MAX_CANDIDATES_PER_BREAK =
    12;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const breakAttributionPath =
    resolve(
        'output',
        replayName,
        'breakable_breaker_attribution.json'
    );


const signalDiscoveryPath =
    resolve(
        'output',
        replayName,
        'break_action_signal_discovery.json'
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
        'breakable_bullet_geometry_validation.json'
    );


// ============================================================
// REQUIRE INPUTS
// ============================================================

for (
    const path
    of [
        replayPath,
        breakAttributionPath,
        signalDiscoveryPath,
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
// LOAD SCRIPT 32 BREAKS
// ============================================================

const breakAttribution =
    JSON.parse(
        readFileSync(
            breakAttributionPath,
            'utf8'
        )
    );


const matchClockOffsetSeconds =
    toFiniteNumber(
        breakAttribution
            ?.timing
            ?.matchClockOffsetSeconds
    )
    ??
    30;


const breaks =
    (
        Array.isArray(
            breakAttribution.attributionRows
        )

            ? breakAttribution.attributionRows

            : []
    )

        .map(
            row => ({

                breakKey:
                    row.breakKey
                    ??
                    `${row.entityIndex}|${row.breakTick}`,

                entityIndex:
                    toFiniteNumber(
                        row.entityIndex
                    ),

                resourceType:
                    row.resourceType
                    ??
                    'UNKNOWN',

                subclassId:
                    row.subclassId ===
                        null
                        ||
                        row.subclassId ===
                        undefined

                        ? null

                        : String(
                            row.subclassId
                        ),

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

                rewardObserved:
                    row.rewardObserved ===
                    true,

                reward:
                    row.reward
                    ??
                    null
            })
        )

        .filter(
            row =>
                row.entityIndex !==
                    null
                &&
                row.breakTick !==
                    null
                &&
                row.position
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
    breaks.length ===
    0
) {

    throw new Error(
        'No usable break events found.'
    );
}


// ============================================================
// BREAK LOOKUPS
// ============================================================

const breakByKey =
    new Map();


const breakByTickAndEntity =
    new Map();


const breakEntityIndexes =
    new Set();


for (
    const row
    of breaks
) {

    breakByKey.set(
        row.breakKey,
        row
    );


    breakByTickAndEntity.set(
        makeTickEntityKey(
            row.breakTick,
            row.entityIndex
        ),
        row
    );


    breakEntityIndexes.add(
        row.entityIndex
    );
}


// ============================================================
// LOAD SCRIPT 33 MELEE MATCHES
// ============================================================

const signalDiscovery =
    JSON.parse(
        readFileSync(
            signalDiscoveryPath,
            'utf8'
        )
    );


const meleeMatches =
    Array.isArray(
        signalDiscovery
            ?.meleeDiagnostic
            ?.matches
    )

        ? signalDiscovery
            .meleeDiagnostic
            .matches

        : [];


const meleeByBreakKey =
    new Map();


for (
    const row
    of meleeMatches
) {

    const best =
        row.bestCandidate;


    if (
        !best
    ) {

        continue;
    }


    meleeByBreakKey.set(
        row.breakKey,
        best
    );
}


// ============================================================
// DEFINE HIGH-CONFIDENCE MELEE
//
// Slightly stricter than Script 33:
//
// - Script 33 strict
// - direct melee reported a hit
// - within ±1 tick
// - <=250 world units
//
// This is used as a comparison group.
//
// We still output Script 33's original strict classification.
// ============================================================

function isHighConfidenceMelee(
    breakKey
) {

    const candidate =
        meleeByBreakKey.get(
            breakKey
        );


    if (
        !candidate
    ) {

        return false;
    }


    return (
        candidate.strict ===
            true
        &&
        candidate.hit ===
            true
        &&
        Math.abs(
            toFiniteNumber(
                candidate.tickDelta
            )
            ??
            Infinity
        )
        <=
        1
        &&
        (
            toFiniteNumber(
                candidate.distance
            )
            ??
            Infinity
        )
        <=
        250
    );
}


// ============================================================
// LOAD PLAYER IDENTITY FROM VERIFIED MELEE
//
// Player pawn indexes are stable in this replay.
//
// This lets us resolve GE_FireBullets.shooterEntity without
// making any inference from proximity.
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


    let row =
        null;


    try {

        row =
            JSON.parse(
                trimmed
            );

    } catch {

        continue;
    }


    const playerName =
        row.playerName
        ??
        null;


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

            playerName,

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
// FIRE WINDOW TICKS
// ============================================================

const fireWindowTickSet =
    new Set();


for (
    const breakEvent
    of breaks
) {

    for (
        let delta =
            -FIRE_WINDOW_TICKS;

        delta <=
            FIRE_WINDOW_TICKS;

        delta++
    ) {

        fireWindowTickSet.add(
            breakEvent.breakTick +
            delta
        );
    }
}


// ============================================================
// PARSED EVENTS
// ============================================================

const debrisEvents =
    [];


const fireEvents =
    [];


const fireEventsByTick =
    new Map();


let totalDebrisMessages =
    0;


let debrisMessagesOnCanonicalBreakTicks =
    0;


let totalFireBulletMessages =
    0;


let fireBulletMessagesInDiagnosticWindows =
    0;


let playerFireBulletMessages =
    0;


let nonPlayerFireBulletMessages =
    0;


let fireMessagesWithTracerAdditional =
    0;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// MESSAGE CAPTURE
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const tick =
            toFiniteNumber(
                demoPacket.tick
            );


        if (
            tick ===
            null
        ) {

            return;
        }


        const typeCode =
            getMessageTypeCode(
                messagePacket
            );


        // ====================================================
        // BREAKABLE DEBRIS
        // ====================================================

        if (
            typeCode ===
            'k_EEntityMsg_BreakablePropSpawnDebris'
        ) {

            totalDebrisMessages++;


            const data =
                messagePacket.data
                ??
                {};


            const targetHandle =
                toFiniteNumber(
                    data
                        ?.entityMsg
                        ?.targetEntity
                );


            const decodedEntityIndex =
                decodeEntityHandleIndex(
                    targetHandle
                );


            const canonicalBreak =
                decodedEntityIndex !==
                    null

                    ? breakByTickAndEntity.get(
                        makeTickEntityKey(
                            tick,
                            decodedEntityIndex
                        )
                    )
                    ??
                    null

                    : null;


            if (
                canonicalBreak
            ) {

                debrisMessagesOnCanonicalBreakTicks++;
            }


            const resolvedEntityIndex =
                tryResolveHandleEntityIndex(
                    targetHandle
                );


            debrisEvents.push({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                targetHandle,

                decodedEntityIndex,

                resolvedEntityIndex,

                decodedAndResolvedAgree:
                    decodedEntityIndex !==
                        null
                    &&
                    resolvedEntityIndex !==
                        null

                        ? decodedEntityIndex ===
                          resolvedEntityIndex

                        : null,

                canonicalBreakKey:
                    canonicalBreak
                        ?.breakKey
                    ??
                    null,

                isCanonicalBreak:
                    canonicalBreak !==
                    null,

                damagePos:
                    normalizePosition(
                        data.damagePos
                    ),

                damageForce:
                    normalizePosition(
                        data.damageForce
                    ),

                damage:
                    toFiniteNumber(
                        data.damage
                    )
            });


            return;
        }


        // ====================================================
        // FIRE BULLETS
        // ====================================================

        if (
            typeCode !==
            'GE_FireBullets'
        ) {

            return;
        }


        totalFireBulletMessages++;


        if (
            !fireWindowTickSet.has(
                tick
            )
        ) {

            return;
        }


        fireBulletMessagesInDiagnosticWindows++;


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

            playerFireBulletMessages++;

        } else {

            nonPlayerFireBulletMessages++;
        }


        const tracerAdditional =
            Array.isArray(
                data.tracerAdditional
            )

                ? data.tracerAdditional

                : [];


        if (
            tracerAdditional.length >
            0
        ) {

            fireMessagesWithTracerAdditional++;
        }


        const fireEvent =
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

                tracerAdditionalCount:
                    tracerAdditional.length
            };


        fireEvents.push(
            fireEvent
        );


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
                fireEvent
            );
    }
);


// ============================================================
// RUN PARSER
// ============================================================

console.log('');

console.log(
    '===================================='
);

console.log(
    'BREAKABLE BULLET GEOMETRY'
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
    `Known player pawns: ${playerByPawnIndex.size}`
);

console.log(
    `Script 33 strict melee: ${
        meleeMatches.filter(
            row =>
                row
                    .bestCandidate
                    ?.strict ===
                true
        ).length
    }`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// MATCH DEBRIS TO BREAKS
// ============================================================

const debrisByBreakKey =
    new Map();


for (
    const debris
    of debrisEvents
) {

    if (
        !debris.canonicalBreakKey
    ) {

        continue;
    }


    if (
        !debrisByBreakKey.has(
            debris.canonicalBreakKey
        )
    ) {

        debrisByBreakKey.set(
            debris.canonicalBreakKey,
            []
        );
    }


    debrisByBreakKey
        .get(
            debris.canonicalBreakKey
        )
        .push(
            debris
        );
}


// ============================================================
// SELECT BEST DEBRIS EVENT
//
// Normally there should be one exact target-handle match.
//
// If multiple exist, prefer the damage position nearest the
// canonical prop coordinate.
// ============================================================

const selectedDebrisByBreakKey =
    new Map();


for (
    const breakEvent
    of breaks
) {

    const rows =
        debrisByBreakKey.get(
            breakEvent.breakKey
        )
        ??
        [];


    if (
        rows.length ===
        0
    ) {

        continue;
    }


    const ranked =
        [...rows]

            .map(
                debris => ({

                    debris,

                    centerDistance:
                        distance3D(
                            debris.damagePos,
                            breakEvent.position
                        )
                })
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    (
                        a.centerDistance
                        ??
                        Infinity
                    )
                    -
                    (
                        b.centerDistance
                        ??
                        Infinity
                    )
            );


    selectedDebrisByBreakKey.set(
        breakEvent.breakKey,
        ranked[0].debris
    );
}


// ============================================================
// DEBRIS VALIDATION
// ============================================================

const breaksWithDebris =
    breaks.filter(
        row =>
            selectedDebrisByBreakKey.has(
                row.breakKey
            )
    );


const debrisResolvedHandleRows =
    debrisEvents.filter(
        row =>
            row.isCanonicalBreak
            &&
            row.resolvedEntityIndex !==
                null
    );


const debrisDecodedResolvedAgreement =
    debrisResolvedHandleRows.filter(
        row =>
            row.decodedAndResolvedAgree ===
            true
    );


// ============================================================
// BUILD BULLET CANDIDATES PER BREAK
// ============================================================

const breakRows =
    [];


for (
    const breakEvent
    of breaks
) {

    const debris =
        selectedDebrisByBreakKey.get(
            breakEvent.breakKey
        )
        ??
        null;


    const targetPoint =
        debris
            ?.damagePos
        ??
        breakEvent.position;


    const targetPointSource =
        debris
            ?.damagePos

            ? 'DEBRIS_DAMAGE_POS'

            : 'BREAKABLE_CENTER';


    const candidates =
        [];


    for (
        let tick =
            breakEvent.breakTick -
            FIRE_WINDOW_TICKS;

        tick <=
            breakEvent.breakTick +
            FIRE_WINDOW_TICKS;

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
                    targetPoint
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


            const rangeValid =
                geometry.alongRayDistance >=
                    -32
                &&
                geometry.alongRayDistance <=
                    maxRange +
                    RANGE_TOLERANCE;


            if (
                !rangeValid
            ) {

                continue;
            }


            if (
                geometry.perpendicularDistance >
                MAX_STORED_RAY_ERROR
            ) {

                continue;
            }


            const tickDelta =
                shot.tick -
                breakEvent.breakTick;


            const forceAlignment =
                debris
                    ?.damageForce

                    ? vectorAlignment(
                        geometry.direction,
                        debris.damageForce
                    )

                    : null;


            const score =
                bulletCandidateScore(
                    tickDelta,
                    geometry.perpendicularDistance,
                    shot.player !==
                        null
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

                shooterEntity:
                    shot.shooterEntity,

                player:
                    shot.player,

                isPlayerShot:
                    shot.player !==
                    null,

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

                targetPoint,

                targetPointSource,

                alongRayDistance:
                    geometry.alongRayDistance,

                perpendicularDistance:
                    geometry.perpendicularDistance,

                closestPointOnRay:
                    geometry.closestPoint,

                forceAlignmentCosine:
                    forceAlignment,

                score
            });
        }
    }


    candidates.sort(
        (
            a,
            b
        ) =>
            a.score -
            b.score
    );


    const playerCandidates =
        candidates.filter(
            row =>
                row.isPlayerShot
        );


    const meleeCandidate =
        meleeByBreakKey.get(
            breakEvent.breakKey
        )
        ??
        null;


    const highConfidenceMelee =
        isHighConfidenceMelee(
            breakEvent.breakKey
        );


    breakRows.push({

        ...breakEvent,

        debris:
            debris
                ? {

                    targetHandle:
                        debris.targetHandle,

                    decodedEntityIndex:
                        debris.decodedEntityIndex,

                    resolvedEntityIndex:
                        debris.resolvedEntityIndex,

                    damagePos:
                        debris.damagePos,

                    damageForce:
                        debris.damageForce,

                    damage:
                        debris.damage
                }

                : null,

        targetPoint,

        targetPointSource,

        script33MeleeCandidate:
            meleeCandidate,

        script33StrictMelee:
            meleeCandidate
                ?.strict ===
            true,

        highConfidenceMelee,

        bulletCandidateCount:
            candidates.length,

        playerBulletCandidateCount:
            playerCandidates.length,

        bestBulletCandidate:
            candidates[0]
            ??
            null,

        bestPlayerBulletCandidate:
            playerCandidates[0]
            ??
            null,

        bulletCandidates:
            candidates.slice(
                0,
                MAX_CANDIDATES_PER_BREAK
            )
    });
}


// ============================================================
// BASIC GROUPS
// ============================================================

const highConfidenceMeleeRows =
    breakRows.filter(
        row =>
            row.highConfidenceMelee
    );


const nonMeleeRows =
    breakRows.filter(
        row =>
            !row.highConfidenceMelee
    );


// ============================================================
// THRESHOLD MATRIX
//
// For each:
//
//     tick window
//     perpendicular ray error
//
// count:
//
// - breaks with >=1 player bullet
// - exactly one candidate player
// - multiple candidate players
// - unique candidate shooter identity
//
// This allows us to choose the eventual attribution criterion
// empirically rather than guessing.
// ============================================================

const thresholdMatrix =
    [];


for (
    const tickWindow
    of TICK_WINDOWS
) {

    for (
        const rayThreshold
        of RAY_ERROR_THRESHOLDS
    ) {

        const allSummary =
            summarizeThresholdMatches(
                breakRows,
                tickWindow,
                rayThreshold
            );


        const nonMeleeSummary =
            summarizeThresholdMatches(
                nonMeleeRows,
                tickWindow,
                rayThreshold
            );


        const meleeSummary =
            summarizeThresholdMatches(
                highConfidenceMeleeRows,
                tickWindow,
                rayThreshold
            );


        thresholdMatrix.push({

            tickWindow,

            tickWindowSeconds:
                tickWindow /
                TICK_RATE,

            rayThreshold,

            allBreaks:
                allSummary,

            breaksWithoutHighConfidenceMelee:
                nonMeleeSummary,

            highConfidenceMeleeBreaks:
                meleeSummary
        });
    }
}


// ============================================================
// BEST CANDIDATE ERROR DISTRIBUTIONS
// ============================================================

const nonMeleeBestPlayerErrors =
    nonMeleeRows

        .map(
            row =>
                row
                    .bestPlayerBulletCandidate
                    ?.perpendicularDistance
        )

        .filter(
            Number.isFinite
        );


const meleeBestPlayerErrors =
    highConfidenceMeleeRows

        .map(
            row =>
                row
                    .bestPlayerBulletCandidate
                    ?.perpendicularDistance
        )

        .filter(
            Number.isFinite
        );


const nonMeleeBestTickDeltas =
    nonMeleeRows

        .map(
            row =>
                row
                    .bestPlayerBulletCandidate
                    ?.tickDelta
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// STRICT-DIAGNOSTIC BULLET SET
//
// This is NOT yet canonical.
//
// It is merely a convenient subset for looking at who/what
// would be attributed under a fairly tight:
//
//     ±1 tick
//     <=64 world-unit ray error
//
// criterion.
// ============================================================

const DIAGNOSTIC_TICK_WINDOW =
    1;


const DIAGNOSTIC_RAY_ERROR =
    64;


const diagnosticBulletRows =
    [];


for (
    const row
    of nonMeleeRows
) {

    const candidates =
        getThresholdCandidates(
            row,
            DIAGNOSTIC_TICK_WINDOW,
            DIAGNOSTIC_RAY_ERROR
        );


    if (
        candidates.length ===
        0
    ) {

        continue;
    }


    const uniquePlayers =
        uniquePlayerNames(
            candidates
        );


    diagnosticBulletRows.push({

        breakKey:
            row.breakKey,

        breakTick:
            row.breakTick,

        breakClock:
            row.breakClock,

        resourceType:
            row.resourceType,

        entityIndex:
            row.entityIndex,

        candidateCount:
            candidates.length,

        uniquePlayerCount:
            uniquePlayers.length,

        uniquePlayers,

        bestCandidate:
            candidates[0],

        candidates:
            candidates.slice(
                0,
                8
            )
    });
}


// ============================================================
// MULTI-BREAK SHOTS
//
// If the same shot geometrically intersects several props on
// the same tick, that is useful evidence for penetration /
// clustered destruction rather than a reason to discard the
// attribution.
// ============================================================

const breaksByDiagnosticShot =
    new Map();


for (
    const row
    of diagnosticBulletRows
) {

    const best =
        row.bestCandidate;


    if (
        !best
    ) {

        continue;
    }


    const key =
        best.fireKey;


    if (
        !breaksByDiagnosticShot.has(
            key
        )
    ) {

        breaksByDiagnosticShot.set(
            key,
            {

                fireKey:
                    key,

                fireTick:
                    best.fireTick,

                player:
                    best.player,

                shotId:
                    best.shotId,

                penetrationPercent:
                    best.penetrationPercent,

                breaks:
                    []
            }
        );
    }


    breaksByDiagnosticShot
        .get(
            key
        )
        .breaks
        .push({

            breakKey:
                row.breakKey,

            entityIndex:
                row.entityIndex,

            resourceType:
                row.resourceType,

            perpendicularDistance:
                best.perpendicularDistance,

            alongRayDistance:
                best.alongRayDistance
        });
}


const multiBreakDiagnosticShots =
    [...breaksByDiagnosticShot.values()]

        .filter(
            row =>
                row.breaks.length >
                1
        )

        .sort(
            (
                a,
                b
            ) =>
                b.breaks.length -
                a.breaks.length
        );


// ============================================================
// DIAGNOSTIC PLAYER SUMMARY
// ============================================================

const diagnosticPlayerSummary =
    countBy(
        diagnosticBulletRows,
        row =>
            row
                .bestCandidate
                ?.player
                ?.playerName
            ??
            'UNKNOWN'
    );


// ============================================================
// DEBRIS DAMAGE DISTRIBUTIONS
// ============================================================

const meleeDebrisDamage =
    highConfidenceMeleeRows

        .map(
            row =>
                row
                    .debris
                    ?.damage
        )

        .filter(
            Number.isFinite
        );


const nonMeleeDebrisDamage =
    nonMeleeRows

        .map(
            row =>
                row
                    .debris
                    ?.damage
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            [
                'Use Script 32 canonical crate/statue break events.',
                'Decode k_EEntityMsg_BreakablePropSpawnDebris.entityMsg.targetEntity using the low 14 entity-index bits and validate against exact break tick + entity index.',
                'Use debris damagePos as the observed impact point whenever available.',
                'Capture GE_FireBullets within ±4 demo ticks of confirmed break events.',
                'Resolve shooterEntity directly against known player pawn/controller entity indexes from authoritative melee telemetry.',
                'Convert GE_FireBullets angles into a 3D ray and calculate the perpendicular distance from that ray to the observed break impact point.',
                'Evaluate multiple ray-error and tick-window thresholds rather than selecting a canonical threshold in advance.',
                'Treat high-confidence direct melee as a separate comparison group.',
                'Do not use nearest-player proximity for breaker attribution.'
            ],

        constants:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds,

                entityIndexMask:
                    ENTITY_INDEX_MASK,

                fireWindowTicks:
                    FIRE_WINDOW_TICKS,

                fireWindowSeconds:
                    FIRE_WINDOW_TICKS /
                    TICK_RATE,

                maxStoredRayError:
                    MAX_STORED_RAY_ERROR,

                rangeTolerance:
                    RANGE_TOLERANCE,

                rayErrorThresholds:
                    RAY_ERROR_THRESHOLDS,

                tickWindows:
                    TICK_WINDOWS,

                diagnosticOnlyCriterion:
                    {

                        tickWindow:
                            DIAGNOSTIC_TICK_WINDOW,

                        rayError:
                            DIAGNOSTIC_RAY_ERROR,

                        canonical:
                            false
                    }
            },

        sourceCounts:
            {

                totalBreaks:
                    breaks.length,

                knownPlayerPawns:
                    playerByPawnIndex.size,

                knownPlayerControllers:
                    playerByControllerIndex.size,

                highConfidenceMeleeBreaks:
                    highConfidenceMeleeRows.length,

                breaksWithoutHighConfidenceMelee:
                    nonMeleeRows.length,

                totalDebrisMessages,

                debrisMessagesOnCanonicalBreakTicks,

                totalFireBulletMessages,

                fireBulletMessagesInDiagnosticWindows,

                playerFireBulletMessages,

                nonPlayerFireBulletMessages,

                fireMessagesWithTracerAdditional
            },

        debrisValidation:
            {

                breaksWithExactTargetHandleDebris:
                    breaksWithDebris.length,

                matchRate:
                    breaks.length >
                    0

                        ? breaksWithDebris.length /
                          breaks.length

                        : null,

                canonicalDebrisRowsWhereHandleResolved:
                    debrisResolvedHandleRows.length,

                decodedIndexAgreesWithResolvedEntityIndex:
                    debrisDecodedResolvedAgreement.length,

                decodedResolvedAgreementRate:
                    debrisResolvedHandleRows.length >
                    0

                        ? debrisDecodedResolvedAgreement.length /
                          debrisResolvedHandleRows.length

                        : null
            },

        bulletGeometry:
            {

                nonMeleeBestPlayerRayError:
                    summarizeNumbers(
                        nonMeleeBestPlayerErrors
                    ),

                meleeBestPlayerRayError:
                    summarizeNumbers(
                        meleeBestPlayerErrors
                    ),

                nonMeleeBestPlayerTickDelta:
                    summarizeNumbers(
                        nonMeleeBestTickDeltas
                    ),

                thresholdMatrix
            },

        diagnostic64UnitOneTick:
            {

                canonical:
                    false,

                tickWindow:
                    DIAGNOSTIC_TICK_WINDOW,

                rayError:
                    DIAGNOSTIC_RAY_ERROR,

                matchedBreaks:
                    diagnosticBulletRows.length,

                rateAmongBreaksWithoutHighConfidenceMelee:
                    nonMeleeRows.length >
                    0

                        ? diagnosticBulletRows.length /
                          nonMeleeRows.length

                        : null,

                perPlayer:
                    diagnosticPlayerSummary,

                multiBreakShotCount:
                    multiBreakDiagnosticShots.length,

                multiBreakShots:
                    multiBreakDiagnosticShots
            },

        debrisDamage:
            {

                highConfidenceMelee:
                    summarizeNumbers(
                        meleeDebrisDamage
                    ),

                breaksWithoutHighConfidenceMelee:
                    summarizeNumbers(
                        nonMeleeDebrisDamage
                    )
            },

        breakRows,

        diagnosticBulletRows
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
// CONSOLE
// ============================================================

console.log(
    'DEBRIS HANDLE VALIDATION'
);

console.log(
    '------------------------'
);

console.log(
    `Canonical breaks with matched debris: ${
        breaksWithDebris.length
    }/${
        breaks.length
    } = ${
        formatPercent(
            breaksWithDebris.length /
            breaks.length
        )
    }`
);

console.log(
    `Handle decode/resolution agreement: ${
        debrisDecodedResolvedAgreement.length
    }/${
        debrisResolvedHandleRows.length
    } = ${
        formatPercent(
            debrisResolvedHandleRows.length >
                0

                ? debrisDecodedResolvedAgreement.length /
                  debrisResolvedHandleRows.length

                : null
        )
    }`
);

console.log('');


console.log(
    'PLAYER BULLET STREAM'
);

console.log(
    '--------------------'
);

console.log(
    `GE_FireBullets total: ${totalFireBulletMessages}`
);

console.log(
    `Inside break windows: ${fireBulletMessagesInDiagnosticWindows}`
);

console.log(
    `Player shots: ${playerFireBulletMessages}`
);

console.log(
    `Non-player/unresolved shots: ${nonPlayerFireBulletMessages}`
);

console.log('');


console.log(
    'MELEE SEPARATION'
);

console.log(
    '----------------'
);

console.log(
    `High-confidence melee breaks: ${
        highConfidenceMeleeRows.length
    }/${
        breaks.length
    } = ${
        formatPercent(
            highConfidenceMeleeRows.length /
            breaks.length
        )
    }`
);

console.log(
    `Remaining for bullet/ability attribution: ${nonMeleeRows.length}`
);

console.log('');


console.log(
    'BULLET GEOMETRY — BREAKS WITHOUT MELEE'
);

console.log(
    '--------------------------------------'
);

console.log(
    'Using ±1 tick:'
);

console.log('');


for (
    const rayThreshold
    of RAY_ERROR_THRESHOLDS
) {

    const row =
        thresholdMatrix.find(
            item =>
                item.tickWindow ===
                    1
                &&
                item.rayThreshold ===
                    rayThreshold
        );


    if (
        !row
    ) {

        continue;
    }


    const summary =
        row.breaksWithoutHighConfidenceMelee;


    console.log(
        `ray <= ${
            String(
                rayThreshold
            ).padStart(
                3
            )
        }  matched=${
            String(
                summary.breaksWithCandidate
            ).padStart(
                4
            )
        }/${
            nonMeleeRows.length
        }  rate=${
            formatPercent(
                summary.matchRate
            ).padStart(
                7
            )
        }  uniquePlayer=${
            String(
                summary.uniquePlayerBreaks
            ).padStart(
                4
            )
        }  ambiguous=${
            String(
                summary.multiplePlayerBreaks
            ).padStart(
                4
            )
        }`
    );
}


console.log('');


console.log(
    'DIAGNOSTIC ONLY: ±1 TICK / 64-UNIT RAY'
);

console.log(
    '--------------------------------------'
);

console.log(
    `Matched non-melee breaks: ${
        diagnosticBulletRows.length
    }/${
        nonMeleeRows.length
    } = ${
        formatPercent(
            diagnosticBulletRows.length /
            nonMeleeRows.length
        )
    }`
);

console.log(
    `Multi-break shots: ${multiBreakDiagnosticShots.length}`
);

console.log('');


console.log(
    'BEST PLAYER-RAY ERROR'
);

console.log(
    '---------------------'
);

console.log(
    'Non-melee breaks:'
);

printNumberSummary(
    summarizeNumbers(
        nonMeleeBestPlayerErrors
    )
);

console.log('');

console.log(
    'Known melee breaks:'
);

printNumberSummary(
    summarizeNumbers(
        meleeBestPlayerErrors
    )
);

console.log('');


console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// THRESHOLD SUMMARY
// ============================================================

function summarizeThresholdMatches(
    rows,
    tickWindow,
    rayThreshold
) {

    let breaksWithCandidate =
        0;


    let singleCandidateBreaks =
        0;


    let multipleCandidateBreaks =
        0;


    let uniquePlayerBreaks =
        0;


    let multiplePlayerBreaks =
        0;


    let exactTickBreaks =
        0;


    let sameShotMultipleCandidateBreaks =
        0;


    for (
        const row
        of rows
    ) {

        const candidates =
            getThresholdCandidates(
                row,
                tickWindow,
                rayThreshold
            );


        if (
            candidates.length ===
            0
        ) {

            continue;
        }


        breaksWithCandidate++;


        if (
            candidates.length ===
            1
        ) {

            singleCandidateBreaks++;

        } else {

            multipleCandidateBreaks++;
        }


        const players =
            uniquePlayerNames(
                candidates
            );


        if (
            players.length ===
            1
        ) {

            uniquePlayerBreaks++;

        } else if (
            players.length >
            1
        ) {

            multiplePlayerBreaks++;
        }


        if (
            candidates.some(
                candidate =>
                    candidate.tickDelta ===
                    0
            )
        ) {

            exactTickBreaks++;
        }


        const shotKeys =
            new Set(
                candidates.map(
                    candidate =>
                        candidate.fireKey
                )
            );


        if (
            shotKeys.size <
            candidates.length
        ) {

            sameShotMultipleCandidateBreaks++;
        }
    }


    return {

        totalBreaks:
            rows.length,

        breaksWithCandidate,

        matchRate:
            rows.length >
            0

                ? breaksWithCandidate /
                  rows.length

                : null,

        singleCandidateBreaks,

        multipleCandidateBreaks,

        uniquePlayerBreaks,

        multiplePlayerBreaks,

        exactTickBreaks,

        sameShotMultipleCandidateBreaks
    };
}


// ============================================================
// THRESHOLD CANDIDATES
// ============================================================

function getThresholdCandidates(
    breakRow,
    tickWindow,
    rayThreshold
) {

    return (
        Array.isArray(
            breakRow.bulletCandidates
        )

            ? breakRow.bulletCandidates

            : []
    )

        .filter(
            candidate =>
                candidate.isPlayerShot ===
                    true
                &&
                Math.abs(
                    candidate.tickDelta
                )
                <=
                tickWindow
                &&
                candidate.perpendicularDistance <=
                    rayThreshold
        )

        .sort(
            (
                a,
                b
            ) =>
                a.score -
                b.score
        );
}


// ============================================================
// BULLET SCORE
//
// This is only for ranking candidate rays.
//
// Geometry remains separately reported.
//
// Prefer:
//
// 1. player shot
// 2. exact tick
// 3. smallest ray error
//
// A shot after the break receives an extra timing penalty.
// ============================================================

function bulletCandidateScore(
    tickDelta,
    perpendicularDistance,
    isPlayerShot
) {

    let score =
        0;


    if (
        !isPlayerShot
    ) {

        score +=
            100000;
    }


    score +=
        Math.abs(
            tickDelta
        )
        *
        10000;


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
// RAY → POINT GEOMETRY
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


    const along =
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
                along,

            y:
                origin.y +
                direction.y *
                along,

            z:
                origin.z +
                direction.z *
                along
        };


    const perpendicularDistance =
        distance3D(
            point,
            closestPoint
        );


    return {

        direction,

        alongRayDistance:
            along,

        perpendicularDistance,

        closestPoint
    };
}


// ============================================================
// SOURCE ANGLES → DIRECTION
//
// Source convention:
//
// pitch:
//     positive = looking downward
//
// yaw:
//     standard XY rotation
//
// Therefore:
//
// x = cos(pitch) cos(yaw)
// y = cos(pitch) sin(yaw)
// z = -sin(pitch)
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


    return normalizeVector(
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
        }
    );
}


// ============================================================
// FORCE ALIGNMENT
// ============================================================

function vectorAlignment(
    unitDirection,
    force
) {

    const normalizedForce =
        normalizeVector(
            force
        );


    if (
        !unitDirection
        ||
        !normalizedForce
    ) {

        return null;
    }


    return (
        unitDirection.x *
        normalizedForce.x
        +
        unitDirection.y *
        normalizedForce.y
        +
        unitDirection.z *
        normalizedForce.z
    );
}


// ============================================================
// NORMALIZE VECTOR
// ============================================================

function normalizeVector(
    value
) {

    if (
        !value
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
        ||
        z ===
        null
    ) {

        return null;
    }


    const length =
        Math.sqrt(
            x *
            x
            +
            y *
            y
            +
            z *
            z
        );


    if (
        length <=
        0
    ) {

        return null;
    }


    return {

        x:
            x /
            length,

        y:
            y /
            length,

        z:
            z /
            length
    };
}


// ============================================================
// ENTITY HANDLE DECODE
// ============================================================

function decodeEntityHandleIndex(
    handle
) {

    if (
        !Number.isFinite(
            handle
        )
    ) {

        return null;
    }


    const integer =
        Math.trunc(
            handle
        );


    // Bitwise AND is safe for these observed Source 2 handles.
    return (
        integer &
        ENTITY_INDEX_MASK
    );
}


// ============================================================
// OPTIONAL DEADEM HANDLE RESOLUTION
//
// Used only to validate our low-14-bit decoding.
// ============================================================

function tryResolveHandleEntityIndex(
    handle
) {

    if (
        !Number.isFinite(
            handle
        )
    ) {

        return null;
    }


    try {

        const entity =
            parser
                .getDemo()
                .getEntityByHandle(
                    handle
                );


        return getEntityIndex(
            entity
        );

    } catch {

        return null;
    }
}


// ============================================================
// ENTITY INDEX
// ============================================================

function getEntityIndex(
    entity
) {

    if (
        !entity
    ) {

        return null;
    }


    const values =
        [

            entity.index,

            entity.entityIndex,

            entity.entIndex,

            entity.id
        ];


    for (
        const value
        of values
    ) {

        const number =
            toFiniteNumber(
                value
            );


        if (
            number !==
            null
        ) {

            return number;
        }
    }


    if (
        typeof entity.getIndex ===
        'function'
    ) {

        try {

            return toFiniteNumber(
                entity.getIndex()
            );

        } catch {
            // Ignore.
        }
    }


    return null;
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
// UNIQUE PLAYERS
// ============================================================

function uniquePlayerNames(
    candidates
) {

    return [
        ...new Set(
            candidates

                .map(
                    row =>
                        row
                            .player
                            ?.playerName
                )

                .filter(
                    Boolean
                )
        )
    ];
}


// ============================================================
// KEYS
// ============================================================

function makeTickEntityKey(
    tick,
    entityIndex
) {

    return `${tick}|${entityIndex}`;
}


function makeFireKey(
    tick,
    shooterEntity,
    shotId,
    shotNumber
) {

    return [
        tick,
        shooterEntity ?? 'NULL',
        serializeValue(
            shotId
        )
        ??
        'NULL',
        shotNumber ?? 'NULL'
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
// DEGREES
// ============================================================

function degreesToRadians(
    degrees
) {

    return (
        degrees *
        Math.PI
        /
        180
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

            p95:
                null,

            p99:
                null,

            max:
                null,

            mean:
                null
        };
    }


    const sum =
        clean.reduce(
            (
                total,
                value
            ) =>
                total +
                value,
            0
        );


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

        p95:
            percentile(
                clean,
                0.95
            ),

        p99:
            percentile(
                clean,
                0.99
            ),

        max:
            clean[
                clean.length -
                1
            ],

        mean:
            sum /
            clean.length
    };
}


// ============================================================
// PERCENTILE
// ============================================================

function percentile(
    sorted,
    proportion
) {

    if (
        sorted.length ===
        0
    ) {

        return null;
    }


    if (
        sorted.length ===
        1
    ) {

        return sorted[0];
    }


    const index =
        (
            sorted.length -
            1
        )
        *
        proportion;


    const lower =
        Math.floor(
            index
        );


    const upper =
        Math.ceil(
            index
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
        index -
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
// PRINT NUMBER SUMMARY
// ============================================================

function printNumberSummary(
    summary
) {

    console.log(
        `  count: ${summary.count}`
    );

    console.log(
        `  min: ${formatNumber(summary.min)}`
    );

    console.log(
        `  p25: ${formatNumber(summary.p25)}`
    );

    console.log(
        `  median: ${formatNumber(summary.median)}`
    );

    console.log(
        `  p75: ${formatNumber(summary.p75)}`
    );

    console.log(
        `  p90: ${formatNumber(summary.p90)}`
    );

    console.log(
        `  p95: ${formatNumber(summary.p95)}`
    );

    console.log(
        `  max: ${formatNumber(summary.max)}`
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
// FORMAT NUMBER
// ============================================================

function formatNumber(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return 'n/a';
    }


    return value.toFixed(
        3
    );
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