import {
    createReadStream,
    writeFileSync
} from 'node:fs';

import {
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

const MATCH_OFFSET =
    30;

// Four ticks = 62.5 ms.
// More than enough for validating 85 / 290 / 335 sec timers.
const SAMPLE_EVERY_TICKS =
    4;

const MAX_FOW_ENTRIES =
    256;

const SPECTATOR_TEAM_NUM =
    1;


const CLASS_INFO =
    new Map([

        [
            34,
            {
                tier: 'SMALL',
                expectedSpawn: 120,
                expectedRespawn: 85
            }
        ],

        [
            35,
            {
                tier: 'MEDIUM',
                expectedSpawn: 300,
                expectedRespawn: 290
            }
        ],

        [
            36,
            {
                tier: 'LARGE',
                expectedSpawn: 480,
                expectedRespawn: 335
            }
        ]
    ]);


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const outputPath =
    resolve(
        'output',
        replayName,
        'fow_camp_respawn_validation.json'
    );


// ============================================================
// STORAGE
// ============================================================

const markerStates =
    new Map();


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            !Number.isFinite(tick)
            ||
            tick % SAMPLE_EVERY_TICKS !== 0
        ) {

            return;
        }


        const matchTime =
            tick /
            TICK_RATE
            -
            MATCH_OFFSET;


        const demo =
            parser.getDemo();


        const teams =
            demo.getEntitiesByClassName(
                'CCitadelTeam'
            );


        const spectator =
            teams.find(
                team =>
                    numberField(
                        team,
                        'm_iTeamNum'
                    )
                    ===
                    SPECTATOR_TEAM_NUM
            );


        if (!spectator) {
            return;
        }


        for (
            let index = 0;
            index < MAX_FOW_ENTRIES;
            index++
        ) {

            const slot =
                String(index)
                    .padStart(
                        4,
                        '0'
                    );


            const prefix =
                `m_vecFOWEntities.${slot}`;


            const name =
                stringField(
                    spectator,
                    `${prefix}.m_strEntityName`
                );


            if (!name) {
                continue;
            }


            const eClass =
                numberField(
                    spectator,
                    `${prefix}.m_eClass`
                );


            if (
                !CLASS_INFO.has(
                    eClass
                )
            ) {

                continue;
            }


            const positionX =
                numberField(
                    spectator,
                    `${prefix}.m_nPositionX`
                );


            const positionY =
                numberField(
                    spectator,
                    `${prefix}.m_nPositionY`
                );


            const visible =
                booleanField(
                    spectator,
                    `${prefix}.m_bVisibleOnMap`
                );


            const hasPosition =
                Number.isFinite(
                    positionX
                )
                &&
                Number.isFinite(
                    positionY
                )
                &&
                (
                    positionX !== 0
                    ||
                    positionY !== 0
                );


            // The marker is considered active only when:
            //
            // 1. it has its actual map position, and
            // 2. the FOW structure says it is visible.
            //
            // This deliberately excludes the pre-spawn (0,0)
            // state.

            const active =
                hasPosition
                &&
                visible === true;


            if (
                !markerStates.has(
                    name
                )
            ) {

                markerStates.set(
                    name,
                    {

                        name,

                        eClass,

                        tier:
                            CLASS_INFO
                                .get(
                                    eClass
                                )
                                .tier,

                        expectedSpawnSeconds:
                            CLASS_INFO
                                .get(
                                    eClass
                                )
                                .expectedSpawn,

                        expectedRespawnSeconds:
                            CLASS_INFO
                                .get(
                                    eClass
                                )
                                .expectedRespawn,

                        fowIndex:
                            index,

                        initialized:
                            false,

                        active:
                            null,

                        hasPosition:
                            null,

                        visible:
                            null,

                        firstActiveTimeSeconds:
                            null,

                        transitions:
                            []
                    }
                );
            }


            const state =
                markerStates.get(
                    name
                );


            // =================================================
            // FIRST OBSERVATION
            // =================================================

            if (
                !state.initialized
            ) {

                state.initialized =
                    true;

                state.active =
                    active;

                state.hasPosition =
                    hasPosition;

                state.visible =
                    visible;


                if (
                    active
                ) {

                    state.firstActiveTimeSeconds =
                        matchTime;
                }


                continue;
            }


            // =================================================
            // ACTIVE STATE CHANGE
            // =================================================

            if (
                active !==
                state.active
            ) {

                const type =
                    active
                        ? 'BECAME_ACTIVE'
                        : 'BECAME_INACTIVE';


                state.transitions.push({

                    type,

                    tick,

                    matchTimeSeconds:
                        matchTime,

                    matchClock:
                        formatClock(
                            matchTime
                        ),

                    positionX,

                    positionY,

                    hasPosition,

                    visible
                });


                if (
                    active
                    &&
                    state.firstActiveTimeSeconds ===
                    null
                ) {

                    state.firstActiveTimeSeconds =
                        matchTime;
                }
            }


            state.active =
                active;

            state.hasPosition =
                hasPosition;

            state.visible =
                visible;
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Tracking direct FOW camp visibility transitions...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// BUILD CYCLES
// ============================================================

const markers =
    [...markerStates.values()]

        .map(
            state => {

                const cycles =
                    [];


                let pendingInactive =
                    null;


                for (
                    const transition
                    of state.transitions
                ) {

                    if (
                        transition.type ===
                        'BECAME_INACTIVE'
                    ) {

                        pendingInactive =
                            transition;

                        continue;
                    }


                    if (
                        transition.type ===
                        'BECAME_ACTIVE'
                        &&
                        pendingInactive
                    ) {

                        const delay =
                            transition.matchTimeSeconds
                            -
                            pendingInactive.matchTimeSeconds;


                        cycles.push({

                            inactiveTimeSeconds:
                                pendingInactive
                                    .matchTimeSeconds,

                            inactiveClock:
                                pendingInactive
                                    .matchClock,

                            activeTimeSeconds:
                                transition
                                    .matchTimeSeconds,

                            activeClock:
                                transition
                                    .matchClock,

                            delaySeconds:
                                delay,

                            expectedRespawnSeconds:
                                state
                                    .expectedRespawnSeconds,

                            errorSeconds:
                                delay
                                -
                                state
                                    .expectedRespawnSeconds,

                            withinOneSecond:
                                Math.abs(
                                    delay
                                    -
                                    state
                                        .expectedRespawnSeconds
                                )
                                <=
                                1
                        });


                        pendingInactive =
                            null;
                    }
                }


                return {

                    name:
                        state.name,

                    eClass:
                        state.eClass,

                    tier:
                        state.tier,

                    fowIndex:
                        state.fowIndex,

                    expectedSpawnSeconds:
                        state.expectedSpawnSeconds,

                    expectedRespawnSeconds:
                        state.expectedRespawnSeconds,

                    firstActiveTimeSeconds:
                        state.firstActiveTimeSeconds,

                    firstActiveClock:
                        Number.isFinite(
                            state.firstActiveTimeSeconds
                        )
                            ? formatClock(
                                state.firstActiveTimeSeconds
                            )
                            : null,

                    spawnErrorSeconds:
                        Number.isFinite(
                            state.firstActiveTimeSeconds
                        )
                            ? state.firstActiveTimeSeconds
                              -
                              state.expectedSpawnSeconds
                            : null,

                    transitionCount:
                        state.transitions.length,

                    transitions:
                        state.transitions,

                    cycleCount:
                        cycles.length,

                    exactLikeCycleCount:
                        cycles.filter(
                            cycle =>
                                cycle.withinOneSecond
                        ).length,

                    cycles
                };
            }
        )

        .sort(
            (
                a,
                b
            ) =>
                a.eClass -
                b.eClass
                ||
                a.name.localeCompare(
                    b.name
                )
        );


// ============================================================
// SUMMARY BY TIER
// ============================================================

const byTier =
    {};


for (
    const tier
    of [
        'SMALL',
        'MEDIUM',
        'LARGE'
    ]
) {

    const rows =
        markers.filter(
            marker =>
                marker.tier ===
                tier
        );


    const cycles =
        rows.flatMap(
            marker =>
                marker.cycles.map(
                    cycle => ({

                        markerName:
                            marker.name,

                        ...cycle
                    })
                )
        );


    byTier[tier] = {

        markerCount:
            rows.length,

        markersWithAtLeastOneCycle:
            rows.filter(
                marker =>
                    marker.cycleCount > 0
            ).length,

        markersWithExpectedTimerCycle:
            rows.filter(
                marker =>
                    marker.exactLikeCycleCount > 0
            ).length,

        totalCycles:
            cycles.length,

        expectedTimerCycles:
            cycles.filter(
                cycle =>
                    cycle.withinOneSecond
            ).length,

        delayStatistics:
            summarize(
                cycles.map(
                    cycle =>
                        cycle.delaySeconds
                )
            ),

        timerLikeDelayStatistics:
            summarize(
                cycles
                    .filter(
                        cycle =>
                            cycle.withinOneSecond
                    )
                    .map(
                        cycle =>
                            cycle.delaySeconds
                    )
            )
    };
}


// ============================================================
// SUSPECT MEDIUM MARKERS
// ============================================================

const suspectNames =
    new Set([

        'sw_bridge_neutrals',

        'rebels_camp_parking_garage_blue',

        'ne_bridge_neutrals',

        'combine_parking_garage_orange'
    ]);


const suspectMarkers =
    markers.filter(
        marker =>
            suspectNames.has(
                marker.name
            )
    );


// ============================================================
// OUTPUT
// ============================================================

const output = {

    replay:
        replayName,

    method:
        'Spectator CCitadelTeam FOW marker active/inactive transitions',

    activeDefinition:
        'm_bVisibleOnMap === true AND m_nPositionX/Y are nonzero',

    summary: {

        totalMarkers:
            markers.length,

        byTier
    },

    suspectMarkers,

    markers
};


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
    '===================================='
);

console.log(
    'FOW CAMP RESPAWN VALIDATION'
);

console.log(
    '===================================='
);

console.log('');


for (
    const tier
    of [
        'SMALL',
        'MEDIUM',
        'LARGE'
    ]
) {

    const summary =
        byTier[tier];


    console.log(
        tier
    );


    console.log(
        `  markers: ${summary.markerCount}`
    );


    console.log(
        `  markers with cycles: ${summary.markersWithAtLeastOneCycle}`
    );


    console.log(
        `  markers with expected timer cycle: ${summary.markersWithExpectedTimerCycle}`
    );


    console.log(
        `  total cycles: ${summary.totalCycles}`
    );


    console.log(
        `  expected-timer cycles: ${summary.expectedTimerCycles}`
    );


    if (
        summary
            .timerLikeDelayStatistics
            .count
        >
        0
    ) {

        console.log(
            `  timer median: ${summary.timerLikeDelayStatistics.median.toFixed(3)}s`
        );
    }


    console.log('');
}


// ============================================================
// SUSPECT MARKERS
// ============================================================

console.log(
    'SUSPECT MEDIUM MARKERS'
);

console.log(
    '----------------------'
);


for (
    const marker
    of suspectMarkers
) {

    console.log('');

    console.log(
        marker.name
    );


    console.log(
        `  first active: ${marker.firstActiveClock}`
    );


    console.log(
        `  transitions: ${marker.transitionCount}`
    );


    console.log(
        `  cycles: ${marker.cycleCount}`
    );


    for (
        const cycle
        of marker.cycles
    ) {

        console.log(

            `    ${cycle.inactiveClock}`

            +

            ` -> ${cycle.activeClock}`

            +

            ` = ${cycle.delaySeconds.toFixed(3)}s`

            +

            (
                cycle.withinOneSecond
                    ? '  MATCH'
                    : ''
            )
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
// HELPERS
// ============================================================

function numberField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    let value;


    try {

        value =
            entity.getField(
                field
            );

    } catch {

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


function stringField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    let value;


    try {

        value =
            entity.getField(
                field
            );

    } catch {

        return null;
    }


    if (
        typeof value !==
        'string'
    ) {

        return null;
    }


    const trimmed =
        value.trim();


    return trimmed.length
        ? trimmed
        : null;
}


function booleanField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    let value;


    try {

        value =
            entity.getField(
                field
            );

    } catch {

        return null;
    }


    return typeof value ===
        'boolean'
        ? value
        : null;
}


function summarize(
    values
) {

    const sorted =
        values

            .filter(
                Number.isFinite
            )

            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );


    if (
        !sorted.length
    ) {

        return {

            count:
                0,

            min:
                null,

            median:
                null,

            max:
                null,

            mean:
                null
        };
    }


    return {

        count:
            sorted.length,

        min:
            sorted[0],

        median:
            percentile(
                sorted,
                0.5
            ),

        max:
            sorted.at(-1),

        mean:
            sorted.reduce(
                (
                    sum,
                    value
                ) =>
                    sum +
                    value,
                0
            )
            /
            sorted.length
    };
}


function percentile(
    values,
    p
) {

    const index =
        (
            values.length -
            1
        )
        *
        p;


    const low =
        Math.floor(
            index
        );


    const high =
        Math.ceil(
            index
        );


    if (
        low ===
        high
    ) {

        return values[
            low
        ];
    }


    const fraction =
        index -
        low;


    return (
        values[low]
        *
        (
            1 -
            fraction
        )
    )
    +
    (
        values[high]
        *
        fraction
    );
}


function formatClock(
    seconds
) {

    if (
        !Number.isFinite(
            seconds
        )
    ) {

        return '—';
    }


    const negative =
        seconds < 0;


    const value =
        Math.abs(
            seconds
        );


    const minutes =
        Math.floor(
            value /
            60
        );


    const secs =
        Math.floor(
            value %
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