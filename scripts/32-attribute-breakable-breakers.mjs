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


const DAMAGE_MESSAGE =
    'k_EUserMsg_Damage';


const PLAYER_CONTROLLER_CLASS =
    'CCitadelPlayerController';


const PLAYER_PAWN_CLASS =
    'CCitadelPlayerPawn';


// We expect the final damage event to occur on the same demo
// tick as the debris/break event.
//
// Keep a small diagnostic window so we can measure reality
// rather than hard-code "same tick" prematurely.
const BREAK_DAMAGE_WINDOW_TICKS =
    4;


// ============================================================
// BREAKABLE TYPES
// ============================================================

const SUBCLASS_CRATE =
    '3986897915';


const SUBCLASS_GOLDEN_STATUE =
    '3719077267';


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const breakValidationPath =
    resolve(
        'output',
        replayName,
        'breakable_respawn_validation.json'
    );


const rewardValidationPath =
    resolve(
        'output',
        replayName,
        'breakable_pickup_activation_validation.json'
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'breakable_breaker_attribution.json'
    );


// ============================================================
// REQUIRE SCRIPT 29
// ============================================================

if (
    !existsSync(
        breakValidationPath
    )
) {

    throw new Error(
        `Missing Script 29 output:\n${breakValidationPath}`
    );
}


// ============================================================
// LOAD BREAK EVENTS
// ============================================================

const breakValidation =
    JSON.parse(
        readFileSync(
            breakValidationPath,
            'utf8'
        )
    );


const matchClockOffsetSeconds =
    Number.isFinite(
        Number(
            breakValidation
                ?.timing
                ?.matchClockOffsetSeconds
        )
    )

        ? Number(
            breakValidation
                .timing
                .matchClockOffsetSeconds
        )

        : 30;


const rawBreakRows =
    Array.isArray(
        breakValidation
            .breakRespawnCandidates
    )

        ? breakValidation
            .breakRespawnCandidates

        : [];


const breaks =
    rawBreakRows

        .map(
            row => {

                const entityIndex =
                    toFiniteNumber(
                        row.entityIndex
                    );


                const breakTick =
                    toFiniteNumber(
                        row.breakTick
                    );


                const subclassId =
                    row.subclassId ===
                    null
                    ||
                    row.subclassId ===
                    undefined

                        ? null

                        : String(
                            row.subclassId
                        );


                return {

                    breakKey:
                        `${entityIndex}|${breakTick}`,

                    entityIndex,

                    subclassId,

                    resourceType:
                        classifyResourceType(
                            subclassId
                        ),

                    breakTick,

                    breakMatchTimeSeconds:
                        Number.isFinite(
                            Number(
                                row.breakMatchTimeSeconds
                            )
                        )

                            ? Number(
                                row.breakMatchTimeSeconds
                            )

                            : tickToMatchTime(
                                breakTick
                            ),

                    breakClock:
                        row.breakClock
                        ??
                        formatClock(
                            tickToMatchTime(
                                breakTick
                            )
                        ),

                    position:
                        normalizePosition(
                            row.position
                        )
                };
            }
        )

        .filter(
            row =>
                Number.isFinite(
                    row.entityIndex
                )
                &&
                Number.isFinite(
                    row.breakTick
                )
                &&
                row.resourceType !==
                    'UNKNOWN'
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
        'No usable break events found in Script 29 output.'
    );
}


// ============================================================
// OPTIONAL SCRIPT 31 REWARD DATA
// ============================================================

const rewardByBreakKey =
    new Map();


if (
    existsSync(
        rewardValidationPath
    )
) {

    try {

        const rewardValidation =
            JSON.parse(
                readFileSync(
                    rewardValidationPath,
                    'utf8'
                )
            );


        const breakResults =
            Array.isArray(
                rewardValidation
                    .breakResults
            )

                ? rewardValidation
                    .breakResults

                : [];


        for (
            const row
            of breakResults
        ) {

            if (
                !row.breakKey
            ) {

                continue;
            }


            rewardByBreakKey.set(
                row.breakKey,
                {

                    rewardObserved:
                        row.rewardObserved ===
                        true,

                    reward:
                        row.reward
                        ??
                        null
                }
            );
        }

    } catch {

        // Script 32 can still run without reward enrichment.
    }
}


// ============================================================
// BREAK INDEX
// ============================================================

const breaksByEntityIndex =
    new Map();


for (
    const breakEvent
    of breaks
) {

    if (
        !breaksByEntityIndex.has(
            breakEvent.entityIndex
        )
    ) {

        breaksByEntityIndex.set(
            breakEvent.entityIndex,
            []
        );
    }


    breaksByEntityIndex
        .get(
            breakEvent.entityIndex
        )
        .push(
            breakEvent
        );
}


const breakableEntityIndexes =
    new Set(
        breaks.map(
            row =>
                row.entityIndex
        )
    );


// ============================================================
// PLAYER CACHE
// ============================================================

const playersByControllerIndex =
    new Map();


const playersByPawnIndex =
    new Map();


// ============================================================
// DAMAGE STORAGE
// ============================================================

const resourceDamageEvents =
    [];


let totalDamageMessages =
    0;


let damageMessagesAgainstBreakables =
    0;


let firstDemoTick =
    null;


let lastDemoTick =
    null;


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// DEMO STATE / PLAYER CACHE
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

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


        if (
            firstDemoTick ===
            null
        ) {

            firstDemoTick =
                tick;
        }


        lastDemoTick =
            tick;


        // Player pawns/controllers are persistent enough that
        // refreshing once per second is more than sufficient.
        if (
            tick %
            TICK_RATE !==
            0
        ) {

            return;
        }


        refreshPlayerMappings(
            tick
        );
    }
);


// ============================================================
// DAMAGE MESSAGE CAPTURE
//
// We only retain damage where the victim entity index is one
// of the 691 known persistent CRATE / GOLDEN_STATUE slots.
//
// This should dramatically reduce the 96,400-message stream.
// ============================================================

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
            DAMAGE_MESSAGE
        ) {

            return;
        }


        totalDamageMessages++;


        const data =
            messagePacket.data
            ??
            {};


        const victimIndex =
            toFiniteNumber(
                data.entindexVictim
            );


        if (
            victimIndex ===
            null
            ||
            !breakableEntityIndexes.has(
                victimIndex
            )
        ) {

            return;
        }


        damageMessagesAgainstBreakables++;


        const demoTick =
            toFiniteNumber(
                demoPacket.tick
            );


        if (
            demoTick ===
            null
        ) {

            return;
        }


        const attackerIndex =
            toFiniteNumber(
                data.entindexAttacker
            );


        const inflictorIndex =
            toFiniteNumber(
                data.entindexInflictor
            );


        const abilityEntityIndex =
            toFiniteNumber(
                data.entindexAbility
            );


        const serverTick =
            toFiniteNumber(
                data.serverTick
            );


        const attackerResolution =
            resolveAttacker(
                attackerIndex
            );


        resourceDamageEvents.push({

            demoTick,

            matchTimeSeconds:
                tickToMatchTime(
                    demoTick
                ),

            matchClock:
                formatClock(
                    tickToMatchTime(
                        demoTick
                    )
                ),

            serverTick,

            serverTickMinusDemoTick:
                serverTick !==
                    null

                    ? serverTick -
                      demoTick

                    : null,

            victimIndex,

            attackerIndex,

            inflictorIndex,

            abilityEntityIndex,

            abilityId:
                serializeValue(
                    data.abilityId
                ),

            attackerClassCode:
                serializeValue(
                    data.attackerClass
                ),

            victimClassCode:
                serializeValue(
                    data.victimClass
                ),

            damage:
                toFiniteNumber(
                    data.damage
                ),

            healthLost:
                toFiniteNumber(
                    data.healthLost
                ),

            preDamage:
                toFiniteNumber(
                    data.preDamage
                ),

            victimHealthNew:
                toFiniteNumber(
                    data.victimHealthNew
                ),

            victimHealthMax:
                toFiniteNumber(
                    data.victimHealthMax
                ),

            damageType:
                serializeValue(
                    data.type
                ),

            citadelType:
                serializeValue(
                    data.citadelType
                ),

            flags:
                serializeValue(
                    data.flags
                ),

            hitgroupId:
                serializeValue(
                    data.hitgroupId
                ),

            effectiveness:
                toFiniteNumber(
                    data.effectiveness
                ),

            origin:
                normalizePosition(
                    data.origin
                ),

            attackerResolution
        });
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');

console.log(
    '===================================='
);

console.log(
    'BREAKABLE BREAKER ATTRIBUTION'
);

console.log(
    '===================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Breaks loaded: ${breaks.length}`
);

console.log(
    `Reward enrichment: ${
        rewardByBreakKey.size > 0
            ? 'YES'
            : 'NO'
    }`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FINAL PLAYER CACHE REFRESH
// ============================================================

refreshPlayerMappings(
    lastDemoTick
);


// ============================================================
// INDEX DAMAGE BY VICTIM
// ============================================================

const damageByVictim =
    new Map();


for (
    const damage
    of resourceDamageEvents
) {

    if (
        !damageByVictim.has(
            damage.victimIndex
        )
    ) {

        damageByVictim.set(
            damage.victimIndex,
            []
        );
    }


    damageByVictim
        .get(
            damage.victimIndex
        )
        .push(
            damage
        );
}


for (
    const rows
    of damageByVictim.values()
) {

    rows.sort(
        (
            a,
            b
        ) =>
            a.demoTick -
            b.demoTick
    );
}


// ============================================================
// MATCH DAMAGE TO EACH BREAK
// ============================================================

const attributionRows =
    [];


for (
    const breakEvent
    of breaks
) {

    const allVictimDamage =
        damageByVictim.get(
            breakEvent.entityIndex
        )
        ??
        [];


    const candidates =
        allVictimDamage.filter(
            damage =>
                Math.abs(
                    damage.demoTick -
                    breakEvent.breakTick
                )
                <=
                BREAK_DAMAGE_WINDOW_TICKS
        );


    const candidateAttackers =
        summarizeCandidateAttackers(
            candidates
        );


    const best =
        selectBestDamageCandidate(
            breakEvent,
            candidates
        );


    const rewardInfo =
        rewardByBreakKey.get(
            breakEvent.breakKey
        )
        ??
        null;


    const bestPlayer =
        best
            ? resolveFinalPlayer(
                best
            )
            : null;


    attributionRows.push({

        ...breakEvent,

        damageCandidateCount:
            candidates.length,

        exactTickDamageCount:
            candidates.filter(
                damage =>
                    damage.demoTick ===
                    breakEvent.breakTick
            ).length,

        uniqueAttackerCount:
            candidateAttackers.length,

        candidateAttackers,

        attributed:
            best !==
            null,

        attributionConfidence:
            classifyAttributionConfidence(
                breakEvent,
                candidates,
                best,
                candidateAttackers
            ),

        breaker:
            bestPlayer,

        selectedDamage:
            best
                ? {

                    demoTick:
                        best.demoTick,

                    tickDelta:
                        best.demoTick -
                        breakEvent.breakTick,

                    serverTick:
                        best.serverTick,

                    serverTickMinusDemoTick:
                        best.serverTickMinusDemoTick,

                    attackerIndex:
                        best.attackerIndex,

                    inflictorIndex:
                        best.inflictorIndex,

                    abilityEntityIndex:
                        best.abilityEntityIndex,

                    abilityId:
                        best.abilityId,

                    damage:
                        best.damage,

                    healthLost:
                        best.healthLost,

                    preDamage:
                        best.preDamage,

                    victimHealthNew:
                        best.victimHealthNew,

                    victimHealthMax:
                        best.victimHealthMax,

                    damageType:
                        best.damageType,

                    citadelType:
                        best.citadelType,

                    flags:
                        best.flags,

                    origin:
                        best.origin,

                    attackerResolution:
                        best.attackerResolution
                }

                : null,

        rewardObserved:
            rewardInfo
                ?.rewardObserved
            ??
            false,

        reward:
            normalizeReward(
                rewardInfo
                    ?.reward
            )
    });
}


// ============================================================
// ATTRIBUTION SUBSETS
// ============================================================

const attributedRows =
    attributionRows.filter(
        row =>
            row.attributed
    );


const exactTickAttributed =
    attributedRows.filter(
        row =>
            row
                .selectedDamage
                ?.tickDelta ===
            0
    );


const playerResolvedRows =
    attributedRows.filter(
        row =>
            row
                .breaker
                ?.playerName
    );


const uniqueAttackerRows =
    attributedRows.filter(
        row =>
            row.uniqueAttackerCount ===
            1
    );


const ambiguousRows =
    attributionRows.filter(
        row =>
            row.attributionConfidence ===
            'AMBIGUOUS_MULTIPLE_ATTACKERS'
    );


const unattributedRows =
    attributionRows.filter(
        row =>
            !row.attributed
    );


// ============================================================
// TIMING DIAGNOSTICS
// ============================================================

const breakDamageTickDeltas =
    attributedRows

        .map(
            row =>
                row
                    .selectedDamage
                    ?.tickDelta
        )

        .filter(
            Number.isFinite
        );


const serverTickOffsets =
    resourceDamageEvents

        .map(
            row =>
                row.serverTickMinusDemoTick
        )

        .filter(
            Number.isFinite
        );


// ============================================================
// ATTACKER CLASS DIAGNOSTICS
// ============================================================

const attackerEntityClassCounts =
    countBy(
        attributedRows,
        row =>
            row
                .selectedDamage
                ?.attackerResolution
                ?.attackerEntityClass
            ??
            'UNRESOLVED'
    );


const damageAbilityCounts =
    countBy(
        attributedRows,
        row =>
            row
                .selectedDamage
                ?.abilityId
            ??
            'NULL'
    );


// ============================================================
// PER-PLAYER SUMMARY
// ============================================================

const playerSummaryMap =
    new Map();


for (
    const row
    of playerResolvedRows
) {

    const playerName =
        row.breaker.playerName;


    if (
        !playerSummaryMap.has(
            playerName
        )
    ) {

        playerSummaryMap.set(
            playerName,
            {

                playerName,

                heroId:
                    row.breaker.heroId
                    ??
                    null,

                team:
                    row.breaker.team
                    ??
                    null,

                totalBreaks:
                    0,

                cratesBroken:
                    0,

                goldenStatuesBroken:
                    0,

                crateSoulRollsSucceeded:
                    0,

                crateSoulRollsFailed:
                    0,

                observedCrateSouls:
                    0,

                goldenStatueRollsSucceeded:
                    0,

                goldenStatueRollsFailed:
                    0,

                modifierSubclassCounts:
                    {}
            }
        );
    }


    const player =
        playerSummaryMap.get(
            playerName
        );


    player.totalBreaks++;


    if (
        row.resourceType ===
        'CRATE'
    ) {

        player.cratesBroken++;


        if (
            row.rewardObserved
        ) {

            player.crateSoulRollsSucceeded++;


            const goldReward =
                toFiniteNumber(
                    row
                        .reward
                        ?.goldReward
                );


            if (
                goldReward !==
                null
            ) {

                player.observedCrateSouls +=
                    goldReward;
            }

        } else {

            player.crateSoulRollsFailed++;
        }
    }


    if (
        row.resourceType ===
        'GOLDEN_STATUE'
    ) {

        player.goldenStatuesBroken++;


        if (
            row.rewardObserved
        ) {

            player.goldenStatueRollsSucceeded++;


            const modifierSubclassId =
                row
                    .reward
                    ?.modifierSubclassId;


            if (
                modifierSubclassId !==
                null
                &&
                modifierSubclassId !==
                undefined
            ) {

                const key =
                    String(
                        modifierSubclassId
                    );


                player
                    .modifierSubclassCounts[
                        key
                    ] =
                        (
                            player
                                .modifierSubclassCounts[
                                    key
                                ]
                            ??
                            0
                        )
                        +
                        1;
            }

        } else {

            player.goldenStatueRollsFailed++;
        }
    }
}


const playerSummaries =
    [...playerSummaryMap.values()]

        .map(
            player => ({

                ...player,

                crateSoulDropRate:
                    player.cratesBroken >
                    0

                        ? player
                            .crateSoulRollsSucceeded
                          /
                          player.cratesBroken

                        : null,

                goldenStatueDropRate:
                    player.goldenStatuesBroken >
                    0

                        ? player
                            .goldenStatueRollsSucceeded
                          /
                          player.goldenStatuesBroken

                        : null
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                b.totalBreaks -
                a.totalBreaks
        );


// ============================================================
// RESOURCE TYPE SUMMARY
// ============================================================

const resourceTypeSummaries =
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


    const attributed =
        rows.filter(
            row =>
                row.attributed
        );


    const resolved =
        rows.filter(
            row =>
                row
                    .breaker
                    ?.playerName
        );


    resourceTypeSummaries.push({

        resourceType,

        breaks:
            rows.length,

        attributedByDamage:
            attributed.length,

        attributionRate:
            rows.length >
            0

                ? attributed.length /
                  rows.length

                : null,

        exactTick:
            attributed.filter(
                row =>
                    row
                        .selectedDamage
                        ?.tickDelta ===
                    0
            ).length,

        resolvedToPlayer:
            resolved.length,

        playerResolutionRate:
            rows.length >
            0

                ? resolved.length /
                  rows.length

                : null,

        ambiguousMultipleAttackers:
            rows.filter(
                row =>
                    row.attributionConfidence ===
                    'AMBIGUOUS_MULTIPLE_ATTACKERS'
            ).length,

        noDamageCandidate:
            rows.filter(
                row =>
                    row.damageCandidateCount ===
                    0
            ).length
    });
}


// ============================================================
// OUTPUT
// ============================================================

const output =
    {

        replay:
            replayName,

        method:
            [
                'Load all confirmed CRATE and GOLDEN_STATUE break events from Script 29.',
                'Capture k_EUserMsg_Damage only when entindexVictim is one of the known persistent breakable resource entity indexes.',
                'Match damage to a break using exact victim entity index and a ±4 demo-tick diagnostic window.',
                'Prefer exact-tick damage, victimHealthNew <= 0 when available, and larger damage when multiple messages exist.',
                'Resolve entindexAttacker to player pawn/controller state when possible.',
                'Optionally join Script 31 reward outcomes to produce per-player realized breakable farming totals.'
            ],

        timing:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds,

                firstDemoTick,

                lastDemoTick,

                matchDurationSeconds:
                    Number.isFinite(
                        lastDemoTick
                    )

                        ? tickToMatchTime(
                            lastDemoTick
                        )

                        : null,

                breakDamageWindowTicks:
                    BREAK_DAMAGE_WINDOW_TICKS,

                breakDamageWindowSeconds:
                    BREAK_DAMAGE_WINDOW_TICKS /
                    TICK_RATE
            },

        sourceCounts:
            {

                totalBreaks:
                    breaks.length,

                totalDamageMessages,

                damageMessagesAgainstBreakableEntityIndexes:
                    damageMessagesAgainstBreakables,

                capturedResourceDamageEvents:
                    resourceDamageEvents.length,

                rewardRowsLoaded:
                    rewardByBreakKey.size
            },

        attributionSummary:
            {

                attributedByDamage:
                    attributedRows.length,

                attributionRate:
                    breaks.length >
                    0

                        ? attributedRows.length /
                          breaks.length

                        : null,

                attributedOnExactBreakTick:
                    exactTickAttributed.length,

                exactTickRateAmongAttributed:
                    attributedRows.length >
                    0

                        ? exactTickAttributed.length /
                          attributedRows.length

                        : null,

                resolvedToNamedPlayer:
                    playerResolvedRows.length,

                namedPlayerResolutionRate:
                    breaks.length >
                    0

                        ? playerResolvedRows.length /
                          breaks.length

                        : null,

                uniqueAttackerCases:
                    uniqueAttackerRows.length,

                ambiguousMultipleAttackers:
                    ambiguousRows.length,

                unattributedBreaks:
                    unattributedRows.length
            },

        timingDiagnostics:
            {

                selectedDamageTickDelta:
                    summarizeNumbers(
                        breakDamageTickDeltas
                    ),

                damageServerTickMinusDemoTick:
                    summarizeNumbers(
                        serverTickOffsets
                    ),

                selectedDamageTickDeltaCounts:
                    countBy(
                        attributedRows,
                        row =>
                            row
                                .selectedDamage
                                ?.tickDelta
                            ??
                            'NULL'
                    )
            },

        attackerDiagnostics:
            {

                attackerEntityClassCounts,

                abilityIdCounts:
                    damageAbilityCounts
            },

        resourceTypeSummaries,

        playerSummaries,

        attributionRows,

        ambiguousRows,

        unattributedRows,

        resourceDamageEvents
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
    'DAMAGE STREAM'
);

console.log(
    '-------------'
);

console.log(
    `Total damage messages: ${totalDamageMessages}`
);

console.log(
    `Damage messages against breakable slots: ${damageMessagesAgainstBreakables}`
);

console.log('');


console.log(
    'BREAKER ATTRIBUTION'
);

console.log(
    '-------------------'
);

console.log(
    `Attributed by exact victim damage: ${
        attributedRows.length
    }/${
        breaks.length
    } = ${
        formatPercent(
            breaks.length >
            0

                ? attributedRows.length /
                  breaks.length

                : null
        )
    }`
);

console.log(
    `Exact break tick: ${
        exactTickAttributed.length
    }/${
        attributedRows.length
    }`
);

console.log(
    `Resolved to named player: ${
        playerResolvedRows.length
    }/${
        breaks.length
    } = ${
        formatPercent(
            breaks.length >
            0

                ? playerResolvedRows.length /
                  breaks.length

                : null
        )
    }`
);

console.log(
    `Ambiguous multiple attackers: ${ambiguousRows.length}`
);

console.log(
    `No attribution: ${unattributedRows.length}`
);

console.log('');


console.log(
    'BY RESOURCE TYPE'
);

console.log(
    '----------------'
);


for (
    const row
    of resourceTypeSummaries
) {

    console.log('');

    console.log(
        row.resourceType
    );

    console.log(
        `  breaks: ${row.breaks}`
    );

    console.log(
        `  damage attributed: ${
            row.attributedByDamage
        } (${
            formatPercent(
                row.attributionRate
            )
        })`
    );

    console.log(
        `  named player: ${
            row.resolvedToPlayer
        } (${
            formatPercent(
                row.playerResolutionRate
            )
        })`
    );

    console.log(
        `  no damage candidate: ${row.noDamageCandidate}`
    );
}


console.log('');

console.log(
    'PER-PLAYER BREAKABLE FARM'
);

console.log(
    '-------------------------'
);


if (
    playerSummaries.length ===
    0
) {

    console.log(
        'No named-player attributions yet.'
    );

} else {

    for (
        const player
        of playerSummaries
    ) {

        console.log('');

        console.log(
            player.playerName
        );

        console.log(
            `  total breaks: ${player.totalBreaks}`
        );

        console.log(
            `  crates: ${player.cratesBroken}`
        );

        console.log(
            `  statues: ${player.goldenStatuesBroken}`
        );

        console.log(
            `  successful soul rolls: ${player.crateSoulRollsSucceeded}`
        );

        console.log(
            `  observed crate souls: ${player.observedCrateSouls}`
        );

        console.log(
            `  statue buffs: ${player.goldenStatueRollsSucceeded}`
        );
    }
}


console.log('');

console.log(
    'ATTACKER ENTITY CLASSES'
);

console.log(
    '-----------------------'
);


for (
    const [
        className,
        count
    ]
    of Object.entries(
        attackerEntityClassCounts
    )
) {

    console.log(
        `${className}: ${count}`
    );
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// DAMAGE CANDIDATE SELECTION
// ============================================================

function selectBestDamageCandidate(
    breakEvent,
    candidates
) {

    if (
        candidates.length ===
        0
    ) {

        return null;
    }


    const ranked =
        [...candidates]
            .sort(
                (
                    a,
                    b
                ) =>
                    damageCandidateScore(
                        breakEvent,
                        a
                    )
                    -
                    damageCandidateScore(
                        breakEvent,
                        b
                    )
            );


    return ranked[0];
}


// ============================================================
// DAMAGE SCORE
//
// Lower = better.
//
// Exact demo tick dominates.
//
// If the engine exposes victimHealthNew, lethal damage receives
// a strong bonus.
//
// Then prefer greater actual health lost/damage.
// ============================================================

function damageCandidateScore(
    breakEvent,
    damage
) {

    const tickDelta =
        Math.abs(
            damage.demoTick -
            breakEvent.breakTick
        );


    let score =
        tickDelta *
        10000;


    if (
        damage.demoTick ===
        breakEvent.breakTick
    ) {

        score -=
            5000;
    }


    if (
        Number.isFinite(
            damage.victimHealthNew
        )
        &&
        damage.victimHealthNew <=
            0
    ) {

        score -=
            2000;
    }


    if (
        Number.isFinite(
            damage.healthLost
        )
    ) {

        score -=
            Math.min(
                damage.healthLost,
                1000
            );
    }


    if (
        Number.isFinite(
            damage.damage
        )
    ) {

        score -=
            Math.min(
                damage.damage,
                1000
            )
            *
            0.1;
    }


    return score;
}


// ============================================================
// ATTRIBUTION CONFIDENCE
// ============================================================

function classifyAttributionConfidence(
    breakEvent,
    candidates,
    best,
    candidateAttackers
) {

    if (
        !best
    ) {

        return 'NO_DAMAGE_MATCH';
    }


    if (
        candidateAttackers.length >
        1
    ) {

        return 'AMBIGUOUS_MULTIPLE_ATTACKERS';
    }


    if (
        best.demoTick ===
        breakEvent.breakTick
        &&
        candidateAttackers.length ===
        1
    ) {

        return 'HIGH_EXACT_TICK_UNIQUE_ATTACKER';
    }


    if (
        candidateAttackers.length ===
        1
    ) {

        return 'MEDIUM_NEAR_TICK_UNIQUE_ATTACKER';
    }


    return 'LOW';
}


// ============================================================
// CANDIDATE ATTACKERS
// ============================================================

function summarizeCandidateAttackers(
    candidates
) {

    const map =
        new Map();


    for (
        const damage
        of candidates
    ) {

        const key =
            damage.attackerIndex ===
            null

                ? 'NULL'

                : String(
                    damage.attackerIndex
                );


        if (
            !map.has(
                key
            )
        ) {

            map.set(
                key,
                {

                    attackerIndex:
                        damage.attackerIndex,

                    count:
                        0,

                    exactTickCount:
                        0,

                    playerName:
                        damage
                            .attackerResolution
                            ?.player
                            ?.playerName
                        ??
                        null,

                    attackerEntityClass:
                        damage
                            .attackerResolution
                            ?.attackerEntityClass
                        ??
                        null
                }
            );
        }


        const row =
            map.get(
                key
            );


        row.count++;


        if (
            damage.demoTick ===
            findClosestBreakTickForVictimDamage(
                damage
            )
        ) {

            row.exactTickCount++;
        }
    }


    return [...map.values()]
        .sort(
            (
                a,
                b
            ) =>
                b.count -
                a.count
        );
}


// ============================================================
// FIND CLOSEST BREAK TICK FOR DIAGNOSTIC
// ============================================================

function findClosestBreakTickForVictimDamage(
    damage
) {

    const rows =
        breaksByEntityIndex.get(
            damage.victimIndex
        )
        ??
        [];


    let bestTick =
        null;


    let bestDelta =
        Infinity;


    for (
        const row
        of rows
    ) {

        const delta =
            Math.abs(
                row.breakTick -
                damage.demoTick
            );


        if (
            delta <
            bestDelta
        ) {

            bestDelta =
                delta;

            bestTick =
                row.breakTick;
        }
    }


    return bestTick;
}


// ============================================================
// FINAL PLAYER RESOLUTION
// ============================================================

function resolveFinalPlayer(
    damage
) {

    const player =
        damage
            ?.attackerResolution
            ?.player;


    if (
        player
        ?.playerName
    ) {

        return player;
    }


    const attackerIndex =
        damage
            ?.attackerIndex;


    if (
        Number.isFinite(
            attackerIndex
        )
    ) {

        if (
            playersByPawnIndex.has(
                attackerIndex
            )
        ) {

            return playersByPawnIndex.get(
                attackerIndex
            );
        }


        if (
            playersByControllerIndex.has(
                attackerIndex
            )
        ) {

            return playersByControllerIndex.get(
                attackerIndex
            );
        }
    }


    return player
        ??
        null;
}


// ============================================================
// ATTACKER RESOLUTION
// ============================================================

function resolveAttacker(
    attackerIndex
) {

    if (
        !Number.isFinite(
            attackerIndex
        )
    ) {

        return {

            attackerEntityIndex:
                attackerIndex,

            attackerEntityClass:
                null,

            player:
                null,

            resolutionMethod:
                'INVALID_ATTACKER_INDEX'
        };
    }


    if (
        playersByPawnIndex.has(
            attackerIndex
        )
    ) {

        return {

            attackerEntityIndex:
                attackerIndex,

            attackerEntityClass:
                PLAYER_PAWN_CLASS,

            player:
                playersByPawnIndex.get(
                    attackerIndex
                ),

            resolutionMethod:
                'CACHED_PAWN_INDEX'
        };
    }


    if (
        playersByControllerIndex.has(
            attackerIndex
        )
    ) {

        return {

            attackerEntityIndex:
                attackerIndex,

            attackerEntityClass:
                PLAYER_CONTROLLER_CLASS,

            player:
                playersByControllerIndex.get(
                    attackerIndex
                ),

            resolutionMethod:
                'CACHED_CONTROLLER_INDEX'
        };
    }


    const entity =
        safeGetEntity(
            attackerIndex
        );


    if (
        !entity
    ) {

        return {

            attackerEntityIndex:
                attackerIndex,

            attackerEntityClass:
                null,

            player:
                null,

            resolutionMethod:
                'ENTITY_NOT_RESOLVED'
        };
    }


    const className =
        entity
            ?.class
            ?.name
        ??
        null;


    if (
        className ===
        PLAYER_PAWN_CLASS
    ) {

        const player =
            resolvePlayerFromPawn(
                entity
            );


        return {

            attackerEntityIndex:
                attackerIndex,

            attackerEntityClass:
                className,

            player,

            resolutionMethod:
                player
                    ? 'DIRECT_PAWN'
                    : 'DIRECT_PAWN_UNNAMED'
        };
    }


    if (
        className ===
        PLAYER_CONTROLLER_CLASS
    ) {

        const player =
            playerFromController(
                entity,
                null
            );


        return {

            attackerEntityIndex:
                attackerIndex,

            attackerEntityClass:
                className,

            player,

            resolutionMethod:
                player
                    ? 'DIRECT_CONTROLLER'
                    : 'DIRECT_CONTROLLER_UNNAMED'
        };
    }


    // --------------------------------------------------------
    // Some damage systems may put an owned entity/ability in
    // entindexAttacker.
    //
    // Attempt to walk common ownership fields back to a pawn.
    // --------------------------------------------------------

    const ownerHandle =
        firstNonNullField(
            entity,
            [

                'm_hOwnerEntity',

                'm_hOwner',

                'm_hOwnerPawn',

                'm_hCaster',

                'm_hHero',

                'm_hPlayer'
            ]
        );


    const ownerEntity =
        safeResolveEntityHandle(
            ownerHandle
        );


    if (
        ownerEntity
    ) {

        const ownerIndex =
            getEntityIndex(
                ownerEntity
            );


        const ownerClass =
            ownerEntity
                ?.class
                ?.name;


        if (
            ownerClass ===
            PLAYER_PAWN_CLASS
        ) {

            const player =
                resolvePlayerFromPawn(
                    ownerEntity
                );


            return {

                attackerEntityIndex:
                    attackerIndex,

                attackerEntityClass:
                    className,

                ownerEntityIndex:
                    ownerIndex,

                ownerEntityClass:
                    ownerClass,

                player,

                resolutionMethod:
                    'OWNED_ENTITY_TO_PAWN'
            };
        }


        if (
            ownerClass ===
            PLAYER_CONTROLLER_CLASS
        ) {

            const player =
                playerFromController(
                    ownerEntity,
                    null
                );


            return {

                attackerEntityIndex:
                    attackerIndex,

                attackerEntityClass:
                    className,

                ownerEntityIndex:
                    ownerIndex,

                ownerEntityClass:
                    ownerClass,

                player,

                resolutionMethod:
                    'OWNED_ENTITY_TO_CONTROLLER'
            };
        }
    }


    return {

        attackerEntityIndex:
            attackerIndex,

        attackerEntityClass:
            className,

        player:
            null,

        resolutionMethod:
            'NON_PLAYER_ENTITY'
    };
}


// ============================================================
// REFRESH PLAYER MAPPINGS
// ============================================================

function refreshPlayerMappings(
    tick
) {

    const demo =
        parser.getDemo();


    let controllers =
        [];


    try {

        controllers =
            Array.from(
                demo.getEntitiesByClassName(
                    PLAYER_CONTROLLER_CLASS
                )
                ??
                []
            );

    } catch {
        // Ignore.
    }


    for (
        const controller
        of controllers
    ) {

        const player =
            playerFromController(
                controller,
                tick
            );


        if (
            !player
        ) {

            continue;
        }


        playersByControllerIndex.set(
            player.controllerEntityIndex,
            player
        );


        if (
            Number.isFinite(
                player.pawnEntityIndex
            )
        ) {

            playersByPawnIndex.set(
                player.pawnEntityIndex,
                player
            );
        }
    }


    // --------------------------------------------------------
    // Also inspect pawns directly in case the controller's pawn
    // field name differs from our candidate list.
    // --------------------------------------------------------

    let pawns =
        [];


    try {

        pawns =
            Array.from(
                demo.getEntitiesByClassName(
                    PLAYER_PAWN_CLASS
                )
                ??
                []
            );

    } catch {
        // Ignore.
    }


    for (
        const pawn
        of pawns
    ) {

        const pawnIndex =
            getEntityIndex(
                pawn
            );


        if (
            pawnIndex ===
            null
        ) {

            continue;
        }


        if (
            playersByPawnIndex.has(
                pawnIndex
            )
        ) {

            continue;
        }


        const player =
            resolvePlayerFromPawn(
                pawn
            );


        if (
            player
        ) {

            playersByPawnIndex.set(
                pawnIndex,
                player
            );
        }
    }
}


// ============================================================
// PLAYER FROM CONTROLLER
// ============================================================

function playerFromController(
    controller,
    tick
) {

    const controllerIndex =
        getEntityIndex(
            controller
        );


    if (
        controllerIndex ===
        null
    ) {

        return null;
    }


    const playerNameRaw =
        firstNonNullField(
            controller,
            [

                'm_sPlayerName',

                'm_iszPlayerName',

                'm_playerName',

                'm_strPlayerName'
            ]
        );


    const heroId =
        toFiniteNumber(
            firstNonNullField(
                controller,
                [

                    'm_nHeroID',

                    'm_nHeroId',

                    'm_eHeroID',

                    'm_iHeroID'
                ]
            )
        );


    const team =
        toFiniteNumber(
            safeGetField(
                controller,
                'm_iTeamNum'
            )
        );


    const pawnHandle =
        firstNonNullField(
            controller,
            [

                'm_hPawn',

                'm_hHeroPawn',

                'm_hPlayerPawn',

                'm_hAssignedHero'
            ]
        );


    const pawnEntity =
        safeResolveEntityHandle(
            pawnHandle
        );


    const pawnEntityIndex =
        getEntityIndex(
            pawnEntity
        );


    return {

        playerName:
            playerNameRaw ===
                null
                ||
                playerNameRaw ===
                undefined

                ? null

                : String(
                    playerNameRaw
                ),

        heroId,

        team,

        controllerEntityIndex:
            controllerIndex,

        pawnEntityIndex,

        lastObservedTick:
            tick
    };
}


// ============================================================
// PLAYER FROM PAWN
// ============================================================

function resolvePlayerFromPawn(
    pawn
) {

    const pawnIndex =
        getEntityIndex(
            pawn
        );


    if (
        pawnIndex ===
        null
    ) {

        return null;
    }


    if (
        playersByPawnIndex.has(
            pawnIndex
        )
    ) {

        return playersByPawnIndex.get(
            pawnIndex
        );
    }


    const controllerHandle =
        firstNonNullField(
            pawn,
            [

                'm_hController',

                'm_hPlayerController',

                'm_hOriginalController'
            ]
        );


    const controller =
        safeResolveEntityHandle(
            controllerHandle
        );


    if (
        controller
    ) {

        const player =
            playerFromController(
                controller,
                null
            );


        if (
            player
        ) {

            player.pawnEntityIndex =
                pawnIndex;


            if (
                Number.isFinite(
                    player.controllerEntityIndex
                )
            ) {

                playersByControllerIndex.set(
                    player.controllerEntityIndex,
                    player
                );
            }


            playersByPawnIndex.set(
                pawnIndex,
                player
            );


            return player;
        }
    }


    return null;
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
// ENTITY LOOKUP
// ============================================================

function safeGetEntity(
    entityIndex
) {

    if (
        !Number.isFinite(
            entityIndex
        )
    ) {

        return null;
    }


    try {

        return (
            parser
                .getDemo()
                .getEntity(
                    entityIndex
                )
            ??
            null
        );

    } catch {

        return null;
    }
}


// ============================================================
// HANDLE LOOKUP
// ============================================================

function safeResolveEntityHandle(
    handle
) {

    if (
        handle ===
        null
        ||
        handle ===
        undefined
    ) {

        return null;
    }


    try {

        return (
            parser
                .getDemo()
                .getEntityByHandle(
                    handle
                )
            ??
            null
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


    const candidates =
        [

            entity.index,

            entity.entityIndex,

            entity.entIndex,

            entity.id
        ];


    for (
        const value
        of candidates
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

            const number =
                toFiniteNumber(
                    entity.getIndex()
                );


            if (
                number !==
                null
            ) {

                return number;
            }

        } catch {
            // Ignore.
        }
    }


    return null;
}


// ============================================================
// FIELD READ
// ============================================================

function safeGetField(
    entity,
    field
) {

    try {

        const value =
            entity.getField(
                field
            );


        return value ===
            undefined

            ? null

            : value;

    } catch {

        return null;
    }
}


function firstNonNullField(
    entity,
    fields
) {

    for (
        const field
        of fields
    ) {

        const value =
            safeGetField(
                entity,
                field
            );


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


// ============================================================
// REWARD NORMALIZATION
// ============================================================

function normalizeReward(
    reward
) {

    if (
        !reward
        ||
        typeof reward !==
        'object'
    ) {

        return null;
    }


    return {

        pickupClass:
            reward.pickupClass
            ??
            null,

        pickupEntityIndex:
            reward.pickupEntityIndex
            ??
            null,

        goldReward:
            toFiniteNumber(
                reward.goldReward
            ),

        modifierSubclassId:
            reward.modifierSubclassId ===
                null
                ||
                reward.modifierSubclassId ===
                undefined

                ? null

                : String(
                    reward.modifierSubclassId
                ),

        strict:
            reward.strict ===
            true
    };
}


// ============================================================
// RESOURCE TYPE
// ============================================================

function classifyResourceType(
    subclassId
) {

    if (
        subclassId ===
        SUBCLASS_CRATE
    ) {

        return 'CRATE';
    }


    if (
        subclassId ===
        SUBCLASS_GOLDEN_STATUE
    ) {

        return 'GOLDEN_STATUE';
    }


    return 'UNKNOWN';
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
// TIME
// ============================================================

function tickToMatchTime(
    tick
) {

    if (
        !Number.isFinite(
            tick
        )
    ) {

        return null;
    }


    return (
        tick /
        TICK_RATE
    )
    -
    matchClockOffsetSeconds;
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
    `${minutes}:`
    +
    String(
        secs
    ).padStart(
        2,
        '0'
    );
}


// ============================================================
// COUNT BY
// ============================================================

function countBy(
    array,
    selector
) {

    const result =
        {};


    for (
        const item
        of array
    ) {

        const rawKey =
            selector(
                item
            );


        const key =
            rawKey ===
                null
                ||
                rawKey ===
                undefined

                ? 'NULL'

                : String(
                    rawKey
                );


        result[
            key
        ] =
            (
                result[
                    key
                ]
                ??
                0
            )
            +
            1;
    }


    return Object.fromEntries(
        Object.entries(
            result
        )
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
        'number'
        ||
        typeof value ===
        'string'
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