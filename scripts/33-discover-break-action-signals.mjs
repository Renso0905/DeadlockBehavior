import {
    existsSync,
    readFileSync,
    createReadStream,
    mkdirSync,
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


// Inspect messages within ±2 ticks of a break.
// Exact-tick behavior is recorded separately.
const MESSAGE_WINDOW_TICKS =
    2;


// Direct melee matching diagnostic.
//
// Do NOT interpret a match as canonical attribution yet.
const MELEE_WINDOW_TICKS =
    4;


const MELEE_MAX_DISTANCE =
    350;


const MELEE_STRICT_DISTANCE =
    250;


// Maximum payload samples saved per message type.
const MAX_SAMPLES_PER_MESSAGE_TYPE =
    6;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const breakPath =
    resolve(
        'output',
        replayName,
        'breakable_breaker_attribution.json'
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
        'break_action_signal_discovery.json'
    );


// ============================================================
// REQUIRE SCRIPT 32
// ============================================================

if (
    !existsSync(
        breakPath
    )
) {

    throw new Error(
        `Missing Script 32 output:\n${breakPath}`
    );
}


// ============================================================
// LOAD BREAKS
// ============================================================

const breakData =
    JSON.parse(
        readFileSync(
            breakPath,
            'utf8'
        )
    );


const rawBreaks =
    Array.isArray(
        breakData.attributionRows
    )
        ? breakData.attributionRows
        : [];


const breaks =
    rawBreaks

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
        'No usable breaks found in Script 32 output.'
    );
}


// ============================================================
// MATCH CLOCK
// ============================================================

const matchClockOffsetSeconds =
    toFiniteNumber(
        breakData
            ?.timing
            ?.matchClockOffsetSeconds
    )
    ??
    30;


const knownLastDemoTick =
    toFiniteNumber(
        breakData
            ?.timing
            ?.lastDemoTick
    )
    ??
    Math.max(
        ...breaks.map(
            row =>
                row.breakTick
        )
    );


// ============================================================
// BREAK-TICK SETS
// ============================================================

const uniqueBreakTicks =
    [
        ...new Set(
            breaks.map(
                row =>
                    row.breakTick
            )
        )
    ]
    .sort(
        numericSort
    );


const exactBreakTickSet =
    new Set(
        uniqueBreakTicks
    );


const breakWindowTickSet =
    new Set();


for (
    const tick
    of uniqueBreakTicks
) {

    for (
        let delta =
            -MESSAGE_WINDOW_TICKS;

        delta <=
            MESSAGE_WINDOW_TICKS;

        delta++
    ) {

        breakWindowTickSet.add(
            tick +
            delta
        );
    }
}


// ============================================================
// CONTROL TICKS
//
// Build one non-break control tick for approximately every
// unique break tick.
//
// This lets us distinguish:
//
//     "this message happens on all gameplay ticks"
//
// from:
//
//     "this message is strongly enriched on break ticks."
// ============================================================

const controlTicks =
    buildControlTicks(
        uniqueBreakTicks,
        breakWindowTickSet,
        knownLastDemoTick
    );


const controlTickSet =
    new Set(
        controlTicks
    );


// ============================================================
// BREAK CLUSTER DIAGNOSTICS
// ============================================================

const breaksPerTick =
    new Map();


for (
    const row
    of breaks
) {

    breaksPerTick.set(

        row.breakTick,

        (
            breaksPerTick.get(
                row.breakTick
            )
            ??
            0
        )
        +
        1
    );
}


const breakClusterDistribution =
    countValues(
        [...breaksPerTick.values()]
    );


const largestBreakClusters =
    [...breaksPerTick.entries()]

        .map(
            (
                [
                    tick,
                    count
                ]
            ) => ({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                breakCount:
                    count,

                resources:
                    breaks
                        .filter(
                            row =>
                                row.breakTick ===
                                tick
                        )
                        .map(
                            row => ({

                                entityIndex:
                                    row.entityIndex,

                                resourceType:
                                    row.resourceType,

                                position:
                                    row.position
                            })
                        )
            })
        )

        .sort(
            (
                a,
                b
            ) =>
                b.breakCount -
                a.breakCount
        )

        .slice(
            0,
            30
        );


// ============================================================
// LOAD DIRECT MELEE EVENTS
// ============================================================

let meleeEvents =
    [];


if (
    existsSync(
        meleePath
    )
) {

    const text =
        readFileSync(
            meleePath,
            'utf8'
        );


    meleeEvents =
        text

            .split(
                /\r?\n/
            )

            .map(
                line =>
                    line.trim()
            )

            .filter(
                Boolean
            )

            .map(
                line => {

                    try {

                        return JSON.parse(
                            line
                        );

                    } catch {

                        return null;
                    }
                }
            )

            .filter(
                Boolean
            )

            .map(
                row => ({

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

                    controllerEntityIndex:
                        toFiniteNumber(
                            row.controllerEntityIndex
                        ),

                    pawnEntityIndex:
                        toFiniteNumber(
                            row.pawnEntityIndex
                        ),

                    attackType:
                        row.attackType
                        ??
                        null,

                    attackTypeCode:
                        toFiniteNumber(
                            row.attackTypeCode
                        ),

                    attackTick:
                        toFiniteNumber(
                            row.firstObservedTick
                        ),

                    attackMatchTimeSeconds:
                        toFiniteNumber(
                            row.firstObservedMatchTimeSeconds
                        ),

                    position:
                        normalizePosition(
                            row.attackPosition
                        ),

                    hit:
                        row.hit ===
                        true
                })
            )

            .filter(
                row =>
                    row.attackTick !==
                        null
                    &&
                    row.position
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a.attackTick -
                    b.attackTick
            );
}


// ============================================================
// MELEE → BREAK DIAGNOSTIC
// ============================================================

const meleeBreakMatches =
    [];


const meleeMatchesByBreak =
    new Map();


for (
    const breakEvent
    of breaks
) {

    const candidates =
        findNearbyMeleeEvents(
            breakEvent
        );


    const best =
        candidates.length >
        0

            ? candidates[0]

            : null;


    if (
        best
    ) {

        meleeMatchesByBreak.set(
            breakEvent.breakKey,
            best
        );
    }


    meleeBreakMatches.push({

        breakKey:
            breakEvent.breakKey,

        breakTick:
            breakEvent.breakTick,

        breakClock:
            breakEvent.breakClock,

        resourceType:
            breakEvent.resourceType,

        resourceEntityIndex:
            breakEvent.entityIndex,

        candidateCount:
            candidates.length,

        bestCandidate:
            best,

        allCandidates:
            candidates.slice(
                0,
                10
            )
    });
}


// ============================================================
// MESSAGE STORAGE
// ============================================================

const exactBreakMessageCounts =
    new Map();


const breakWindowMessageCounts =
    new Map();


const controlMessageCounts =
    new Map();


const exactBreakTicksByType =
    new Map();


const breakWindowTicksByType =
    new Map();


const controlTicksByType =
    new Map();


const messageSamples =
    new Map();


const messageFieldPaths =
    new Map();


const actionMessagesByTick =
    new Map();


let firstDemoTick =
    null;


let lastDemoTick =
    null;


let totalMessagesSeen =
    0;


let messagesOnExactBreakTicks =
    0;


let messagesInBreakWindows =
    0;


let messagesOnControlTicks =
    0;


// ============================================================
// TYPES NOT WORTH SAVING PAYLOADS FOR
//
// We still count them.
//
// Their payloads are simply too large/noisy.
// ============================================================

const PAYLOAD_SAMPLE_SKIP_TYPES =
    new Set(
        [

            'svc_UserCmds',

            'svc_PacketEntities',

            'UM_ParticleManager'
        ]
    );


// ============================================================
// LIKELY ACTION/EVENT TYPES
// ============================================================

function looksActionRelevantType(
    typeCode
) {

    if (
        !typeCode
    ) {

        return false;
    }


    if (
        typeCode ===
        'GE_Source1LegacyGameEvent'
    ) {

        return true;
    }


    return (
        /fire/i.test(
            typeCode
        )
        ||
        /bullet/i.test(
            typeCode
        )
        ||
        /shoot/i.test(
            typeCode
        )
        ||
        /weapon/i.test(
            typeCode
        )
        ||
        /attack/i.test(
            typeCode
        )
        ||
        /melee/i.test(
            typeCode
        )
        ||
        /ability/i.test(
            typeCode
        )
        ||
        /projectile/i.test(
            typeCode
        )
        ||
        /damage/i.test(
            typeCode
        )
        ||
        /hit/i.test(
            typeCode
        )
        ||
        /break/i.test(
            typeCode
        )
        ||
        /prop/i.test(
            typeCode
        )
    );
}


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// DEMO TICK
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
    }
);


// ============================================================
// MESSAGE DIAGNOSTIC
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        totalMessagesSeen++;


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
            )
            ??
            'UNKNOWN';


        const onExactBreakTick =
            exactBreakTickSet.has(
                tick
            );


        const inBreakWindow =
            breakWindowTickSet.has(
                tick
            );


        const onControlTick =
            controlTickSet.has(
                tick
            );


        if (
            !onExactBreakTick
            &&
            !inBreakWindow
            &&
            !onControlTick
        ) {

            return;
        }


        // ----------------------------------------------------
        // EXACT BREAK TICKS
        // ----------------------------------------------------

        if (
            onExactBreakTick
        ) {

            messagesOnExactBreakTicks++;


            incrementCounter(
                exactBreakMessageCounts,
                typeCode
            );


            addTickForType(
                exactBreakTicksByType,
                typeCode,
                tick
            );
        }


        // ----------------------------------------------------
        // BREAK WINDOW
        // ----------------------------------------------------

        if (
            inBreakWindow
        ) {

            messagesInBreakWindows++;


            incrementCounter(
                breakWindowMessageCounts,
                typeCode
            );


            addTickForType(
                breakWindowTicksByType,
                typeCode,
                tick
            );
        }


        // ----------------------------------------------------
        // CONTROL
        // ----------------------------------------------------

        if (
            onControlTick
        ) {

            messagesOnControlTicks++;


            incrementCounter(
                controlMessageCounts,
                typeCode
            );


            addTickForType(
                controlTicksByType,
                typeCode,
                tick
            );
        }


        // ----------------------------------------------------
        // PAYLOAD SAMPLES
        //
        // Only exact break ticks are particularly interesting.
        // ----------------------------------------------------

        if (
            !onExactBreakTick
        ) {

            return;
        }


        if (
            !PAYLOAD_SAMPLE_SKIP_TYPES.has(
                typeCode
            )
        ) {

            saveMessageSample(
                typeCode,
                tick,
                messagePacket.data
            );
        }


        // ----------------------------------------------------
        // ACTION-RELEVANT MESSAGE CONTEXT
        // ----------------------------------------------------

        if (
            looksActionRelevantType(
                typeCode
            )
        ) {

            if (
                !actionMessagesByTick.has(
                    tick
                )
            ) {

                actionMessagesByTick.set(
                    tick,
                    []
                );
            }


            const rows =
                actionMessagesByTick.get(
                    tick
                );


            if (
                rows.length <
                100
            ) {

                rows.push({

                    type:
                        typeCode,

                    data:
                        sanitizeValue(
                            messagePacket.data,
                            0
                        )
                });
            }
        }
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
    'BREAK ACTION SIGNAL DISCOVERY'
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
    `Unique break ticks: ${uniqueBreakTicks.length}`
);

console.log(
    `Control ticks: ${controlTicks.length}`
);

console.log(
    `Direct melee events loaded: ${meleeEvents.length}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// MESSAGE-TYPE SUMMARY
// ============================================================

const allObservedTypes =
    new Set(
        [

            ...exactBreakMessageCounts.keys(),

            ...breakWindowMessageCounts.keys(),

            ...controlMessageCounts.keys()
        ]
    );


const messageTypeSummary =
    [];


for (
    const typeCode
    of allObservedTypes
) {

    const exactMessageCount =
        exactBreakMessageCounts.get(
            typeCode
        )
        ??
        0;


    const windowMessageCount =
        breakWindowMessageCounts.get(
            typeCode
        )
        ??
        0;


    const controlMessageCount =
        controlMessageCounts.get(
            typeCode
        )
        ??
        0;


    const exactTicksCovered =
        exactBreakTicksByType.get(
            typeCode
        )
        ?.size
        ??
        0;


    const windowTicksCovered =
        breakWindowTicksByType.get(
            typeCode
        )
        ?.size
        ??
        0;


    const controlTicksCovered =
        controlTicksByType.get(
            typeCode
        )
        ?.size
        ??
        0;


    const breakCoverage =
        uniqueBreakTicks.length >
        0

            ? exactTicksCovered /
              uniqueBreakTicks.length

            : null;


    const controlCoverage =
        controlTicks.length >
        0

            ? controlTicksCovered /
              controlTicks.length

            : null;


    let enrichment =
        null;


    if (
        Number.isFinite(
            breakCoverage
        )
    ) {

        if (
            controlCoverage ===
            0
        ) {

            enrichment =
                breakCoverage >
                0

                    ? Infinity

                    : null;

        } else if (
            Number.isFinite(
                controlCoverage
            )
        ) {

            enrichment =
                breakCoverage /
                controlCoverage;
        }
    }


    messageTypeSummary.push({

        type:
            typeCode,

        actionRelevant:
            looksActionRelevantType(
                typeCode
            ),

        exactBreakMessageCount:
            exactMessageCount,

        exactBreakTicksCovered:
            exactTicksCovered,

        exactBreakTickCoverage:
            breakCoverage,

        breakWindowMessageCount:
            windowMessageCount,

        breakWindowTicksCovered:
            windowTicksCovered,

        controlMessageCount,

        controlTicksCovered,

        controlTickCoverage:
            controlCoverage,

        enrichmentRatio:
            enrichment,

        sampledFieldPaths:
            [
                ...(
                    messageFieldPaths.get(
                        typeCode
                    )
                    ??
                    new Set()
                )
            ]
            .sort()
    });
}


messageTypeSummary.sort(
    (
        a,
        b
    ) => {

        // Action-relevant types first.
        if (
            a.actionRelevant !==
            b.actionRelevant
        ) {

            return a.actionRelevant
                ? -1
                : 1;
        }


        const enrichA =
            a.enrichmentRatio ===
                Infinity

                ? Number.MAX_SAFE_INTEGER

                : (
                    a.enrichmentRatio
                    ??
                    -1
                );


        const enrichB =
            b.enrichmentRatio ===
                Infinity

                ? Number.MAX_SAFE_INTEGER

                : (
                    b.enrichmentRatio
                    ??
                    -1
                );


        if (
            enrichA !==
            enrichB
        ) {

            return enrichB -
                enrichA;
        }


        return (
            b.exactBreakTicksCovered -
            a.exactBreakTicksCovered
        );
    }
);


// ============================================================
// MESSAGE SAMPLES OUTPUT
// ============================================================

const messageSamplesOutput =
    {};


for (
    const [
        typeCode,
        rows
    ]
    of messageSamples
) {

    messageSamplesOutput[
        typeCode
    ] =
        rows;
}


// ============================================================
// ACTION CONTEXT BY BREAK TICK
// ============================================================

const actionContextByBreakTick =
    uniqueBreakTicks

        .map(
            tick => ({

                tick,

                matchTimeSeconds:
                    tickToMatchTime(
                        tick
                    ),

                clock:
                    formatClock(
                        tickToMatchTime(
                            tick
                        )
                    ),

                breakCount:
                    breaksPerTick.get(
                        tick
                    )
                    ??
                    0,

                resources:
                    breaks
                        .filter(
                            row =>
                                row.breakTick ===
                                tick
                        )
                        .map(
                            row => ({

                                breakKey:
                                    row.breakKey,

                                entityIndex:
                                    row.entityIndex,

                                resourceType:
                                    row.resourceType,

                                position:
                                    row.position
                            })
                        ),

                actionMessages:
                    actionMessagesByTick.get(
                        tick
                    )
                    ??
                    []
            })
        );


// ============================================================
// MELEE SUMMARY
// ============================================================

const breaksWithAnyMeleeCandidate =
    meleeBreakMatches.filter(
        row =>
            row.candidateCount >
            0
    );


const breaksWithStrictMeleeCandidate =
    meleeBreakMatches.filter(
        row =>
            row
                .bestCandidate
                ?.strict ===
            true
    );


const strictMeleeByPlayer =
    countBy(
        breaksWithStrictMeleeCandidate,
        row =>
            row
                .bestCandidate
                ?.playerName
            ??
            'UNKNOWN'
    );


const meleeTypeCounts =
    countBy(
        breaksWithStrictMeleeCandidate,
        row =>
            row
                .bestCandidate
                ?.attackType
            ??
            'UNKNOWN'
    );


// ============================================================
// FIRE-BULLET TYPES
// ============================================================

const fireBulletTypes =
    messageTypeSummary.filter(
        row =>
            /fire.*bullet|bullet.*fire/i
            .test(
                row.type
            )
    );


// ============================================================
// ACTION-CANDIDATE TYPES
// ============================================================

const likelyActionSignalTypes =
    messageTypeSummary

        .filter(
            row =>
                row.actionRelevant
                &&
                row.exactBreakTicksCovered >
                    0
        )

        .slice(
            0,
            50
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
                'Use all confirmed crate/statue destruction ticks as the behavioral event anchor.',
                'Count every message type on exact break ticks and within ±2 ticks.',
                'Compare break-tick message coverage against an equal-sized set of non-break control ticks.',
                'Save bounded payload samples and field paths for messages occurring on break ticks.',
                'Load authoritative CCitadel_Ability_HoldMelee events and test spatial/temporal overlap with breakables.',
                'Do not attribute a breaker from proximity alone.'
            ],

        timing:
            {

                tickRate:
                    TICK_RATE,

                matchClockOffsetSeconds,

                firstDemoTick,

                lastDemoTick,

                messageWindowTicks:
                    MESSAGE_WINDOW_TICKS,

                messageWindowSeconds:
                    MESSAGE_WINDOW_TICKS /
                    TICK_RATE,

                meleeWindowTicks:
                    MELEE_WINDOW_TICKS,

                meleeWindowSeconds:
                    MELEE_WINDOW_TICKS /
                    TICK_RATE
            },

        breaks:
            {

                totalBreaks:
                    breaks.length,

                uniqueBreakTicks:
                    uniqueBreakTicks.length,

                clusterSizeDistribution:
                    breakClusterDistribution,

                largestClusters:
                    largestBreakClusters
            },

        controls:
            {

                controlTickCount:
                    controlTicks.length,

                controlTicks
            },

        messageScan:
            {

                totalMessagesSeen,

                messagesOnExactBreakTicks,

                messagesInBreakWindows,

                messagesOnControlTicks,

                observedMessageTypeCount:
                    messageTypeSummary.length
            },

        likelyActionSignalTypes,

        fireBulletTypes,

        messageTypeSummary,

        messageSamples:
            messageSamplesOutput,

        meleeDiagnostic:
            {

                directMeleeEventsLoaded:
                    meleeEvents.length,

                breaksWithAnyCandidate:
                    breaksWithAnyMeleeCandidate.length,

                anyCandidateRate:
                    breaks.length >
                    0

                        ? breaksWithAnyMeleeCandidate.length /
                          breaks.length

                        : null,

                breaksWithStrictCandidate:
                    breaksWithStrictMeleeCandidate.length,

                strictCandidateRate:
                    breaks.length >
                    0

                        ? breaksWithStrictMeleeCandidate.length /
                          breaks.length

                        : null,

                strictMatchesByPlayer:
                    strictMeleeByPlayer,

                strictMatchesByAttackType:
                    meleeTypeCounts,

                matches:
                    meleeBreakMatches
            },

        actionContextByBreakTick
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
    'BREAK CLUSTERS'
);

console.log(
    '--------------'
);

console.log(
    `Unique break ticks: ${uniqueBreakTicks.length}`
);

console.log(
    `Largest single-tick cluster: ${
        largestBreakClusters[0]
            ?.breakCount
        ??
        0
    } props`
);

console.log('');


console.log(
    'DIRECT MELEE OVERLAP'
);

console.log(
    '--------------------'
);

console.log(
    `Any melee candidate: ${
        breaksWithAnyMeleeCandidate.length
    }/${
        breaks.length
    } = ${
        formatPercent(
            breaksWithAnyMeleeCandidate.length /
            breaks.length
        )
    }`
);

console.log(
    `Strict melee candidate: ${
        breaksWithStrictMeleeCandidate.length
    }/${
        breaks.length
    } = ${
        formatPercent(
            breaksWithStrictMeleeCandidate.length /
            breaks.length
        )
    }`
);

console.log('');


console.log(
    'TOP ACTION-RELEVANT MESSAGE TYPES'
);

console.log(
    '---------------------------------'
);


for (
    const row
    of likelyActionSignalTypes.slice(
        0,
        25
    )
) {

    const enrichmentText =
        row.enrichmentRatio ===
            Infinity

            ? 'INF'

            : Number.isFinite(
                row.enrichmentRatio
            )

                ? row.enrichmentRatio.toFixed(
                    2
                )

                : 'n/a';


    console.log(
        `${
            row.type.padEnd(
                46
            )
        } breakTicks=${
            String(
                row.exactBreakTicksCovered
            ).padStart(
                4
            )
        } coverage=${
            formatPercent(
                row.exactBreakTickCoverage
            ).padStart(
                8
            )
        } control=${
            formatPercent(
                row.controlTickCoverage
            ).padStart(
                8
            )
        } enrich=${
            enrichmentText
        }`
    );
}


console.log('');


console.log(
    'FIRE BULLET SIGNALS'
);

console.log(
    '-------------------'
);


if (
    fireBulletTypes.length ===
    0
) {

    console.log(
        'No FireBullets-type messages found on break ticks.'
    );

} else {

    for (
        const row
        of fireBulletTypes
    ) {

        console.log(
            `${
                row.type
            }: ${
                row.exactBreakTicksCovered
            } break ticks (${
                formatPercent(
                    row.exactBreakTickCoverage
                )
            })`
        );
    }
}


console.log('');

console.log(
    `Output:\n${outputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// MELEE MATCHING
// ============================================================

function findNearbyMeleeEvents(
    breakEvent
) {

    const matches =
        [];


    for (
        const melee
        of meleeEvents
    ) {

        const deltaTicks =
            melee.attackTick -
            breakEvent.breakTick;


        if (
            deltaTicks <
            -MELEE_WINDOW_TICKS
        ) {

            continue;
        }


        if (
            deltaTicks >
            MELEE_WINDOW_TICKS
        ) {

            // Events sorted by tick.
            if (
                melee.attackTick >
                breakEvent.breakTick
                +
                MELEE_WINDOW_TICKS
            ) {

                break;
            }


            continue;
        }


        const distance =
            distance3D(
                melee.position,
                breakEvent.position
            );


        if (
            !Number.isFinite(
                distance
            )
            ||
            distance >
            MELEE_MAX_DISTANCE
        ) {

            continue;
        }


        const strict =
            (
                Math.abs(
                    deltaTicks
                )
                <=
                2
                &&
                distance <=
                MELEE_STRICT_DISTANCE
            );


        const score =
            Math.abs(
                deltaTicks
            )
            *
            100
            +
            distance;


        matches.push({

            playerName:
                melee.playerName,

            heroId:
                melee.heroId,

            team:
                melee.team,

            controllerEntityIndex:
                melee.controllerEntityIndex,

            pawnEntityIndex:
                melee.pawnEntityIndex,

            attackType:
                melee.attackType,

            attackTypeCode:
                melee.attackTypeCode,

            attackTick:
                melee.attackTick,

            attackMatchTimeSeconds:
                melee.attackMatchTimeSeconds,

            attackPosition:
                melee.position,

            hit:
                melee.hit,

            tickDelta:
                deltaTicks,

            timeDeltaSeconds:
                deltaTicks /
                TICK_RATE,

            distance,

            strict,

            score
        });
    }


    matches.sort(
        (
            a,
            b
        ) =>
            a.score -
            b.score
    );


    return matches;
}


// ============================================================
// CONTROL TICKS
// ============================================================

function buildControlTicks(
    breakTicks,
    forbiddenTicks,
    maxTick
) {

    const controls =
        [];


    const used =
        new Set();


    for (
        const breakTick
        of breakTicks
    ) {

        let selected =
            null;


        // Try a sequence of deterministic offsets.
        //
        // Controls remain reproducible across runs.
        const offsets =
            [

                17,
                31,
                47,
                73,
                101,
                149,
                211,
                307,
                419,
                601,
                -17,
                -31,
                -47,
                -73,
                -101,
                -149,
                -211,
                -307
            ];


        for (
            const offset
            of offsets
        ) {

            const candidate =
                breakTick +
                offset;


            if (
                candidate <
                0
                ||
                candidate >
                maxTick
            ) {

                continue;
            }


            if (
                forbiddenTicks.has(
                    candidate
                )
            ) {

                continue;
            }


            if (
                used.has(
                    candidate
                )
            ) {

                continue;
            }


            selected =
                candidate;


            break;
        }


        if (
            selected ===
            null
        ) {

            continue;
        }


        controls.push(
            selected
        );


        used.add(
            selected
        );
    }


    return controls.sort(
        numericSort
    );
}


// ============================================================
// MESSAGE SAMPLE
// ============================================================

function saveMessageSample(
    typeCode,
    tick,
    data
) {

    if (
        !messageSamples.has(
            typeCode
        )
    ) {

        messageSamples.set(
            typeCode,
            []
        );
    }


    const rows =
        messageSamples.get(
            typeCode
        );


    if (
        rows.length <
        MAX_SAMPLES_PER_MESSAGE_TYPE
    ) {

        const sanitized =
            sanitizeValue(
                data,
                0
            );


        rows.push({

            tick,

            matchTimeSeconds:
                tickToMatchTime(
                    tick
                ),

            clock:
                formatClock(
                    tickToMatchTime(
                        tick
                    )
                ),

            data:
                sanitized
        });


        if (
            !messageFieldPaths.has(
                typeCode
            )
        ) {

            messageFieldPaths.set(
                typeCode,
                new Set()
            );
        }


        collectFieldPaths(
            sanitized,
            '',
            messageFieldPaths.get(
                typeCode
            ),
            0
        );
    }
}


// ============================================================
// SAFE SERIALIZER
// ============================================================

function sanitizeValue(
    value,
    depth
) {

    if (
        depth >
        5
    ) {

        return '[MAX_DEPTH]';
    }


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


    if (
        value instanceof Uint8Array
    ) {

        return {

            type:
                'Uint8Array',

            byteLength:
                value.byteLength
        };
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return value
            .slice(
                0,
                30
            )
            .map(
                child =>
                    sanitizeValue(
                        child,
                        depth +
                        1
                    )
            );
    }


    if (
        typeof value ===
        'object'
    ) {

        const output =
            {};


        let count =
            0;


        for (
            const [
                key,
                child
            ]
            of Object.entries(
                value
            )
        ) {

            if (
                count >=
                60
            ) {

                output.__TRUNCATED__ =
                    true;

                break;
            }


            output[
                key
            ] =
                sanitizeValue(
                    child,
                    depth +
                    1
                );


            count++;
        }


        return output;
    }


    return String(
        value
    );
}


// ============================================================
// FIELD PATHS
// ============================================================

function collectFieldPaths(
    value,
    prefix,
    output,
    depth
) {

    if (
        depth >
        5
        ||
        !value
        ||
        typeof value !==
        'object'
    ) {

        return;
    }


    if (
        Array.isArray(
            value
        )
    ) {

        return;
    }


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
            prefix
                ? `${prefix}.${key}`
                : key;


        output.add(
            path
        );


        if (
            child
            &&
            typeof child ===
            'object'
            &&
            !Array.isArray(
                child
            )
        ) {

            collectFieldPaths(
                child,
                path,
                output,
                depth +
                1
            );
        }
    }
}


// ============================================================
// TYPE/TICK COUNTERS
// ============================================================

function addTickForType(
    map,
    type,
    tick
) {

    if (
        !map.has(
            type
        )
    ) {

        map.set(
            type,
            new Set()
        );
    }


    map.get(
        type
    ).add(
        tick
    );
}


function incrementCounter(
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


// ============================================================
// COUNT VALUES
// ============================================================

function countValues(
    values
) {

    const map =
        new Map();


    for (
        const value
        of values
    ) {

        const key =
            String(
                value
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
                    Number(
                        a[0]
                    )
                    -
                    Number(
                        b[0]
                    )
            )
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
// SORT
// ============================================================

function numericSort(
    a,
    b
) {

    return a -
        b;
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