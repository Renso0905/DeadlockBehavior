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


const MATCH_CLOCK_OFFSET_SECONDS =
    30;


const ENTITY_INDEX_MASK =
    0x3fff;


// ============================================================
// CLUSTERING
//
// Individual 1-HP proxy entities may correspond to individual
// Troopers riding together.
//
// If one is shot and all fall together, we should observe
// multiple proxy terminations tightly grouped in time/space.
// ============================================================

const CLUSTER_MAX_TICK_GAP =
    6;


const CLUSTER_MAX_DISTANCE_3D =
    500;


// ============================================================
// NORMAL-TROOPER ASSOCIATION
// ============================================================

const NEARBY_NORMAL_RADIUS =
    1200;


const MAX_NEARBY_NORMALS_PER_PROXY =
    12;


// ============================================================
// DIRECT HANDLE-LINK DISCOVERY
//
// If normal Troopers are parented/owned by the 1-HP transport
// entities while riding, this is potentially decisive.
// ============================================================

const HANDLE_FIELDS =
    [
        'CBodyComponent.m_hParent',
        'm_hOwnerEntity',
        'm_hOwner'
    ];


// ============================================================
// OUTPUT LIMITS
// ============================================================

const MAX_RAW_PROXY_EXAMPLES =
    150;


const MAX_PARENT_TRANSITION_EXAMPLES =
    150;


const MAX_CLUSTER_EXAMPLES =
    200;


const PROGRESS_EVERY_TROOPER_EVENTS =
    1_000_000;


// ============================================================
// PATHS
// ============================================================

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const typeSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_type_classification_v01.json'
    );


const outputSummaryPath =
    resolve(
        'output',
        replayName,
        'trooper_zipline_transport_validation.json'
    );


const outputEventsPath =
    resolve(
        'output',
        replayName,
        'trooper_zipline_dismount_events.jsonl'
    );


if (
    !existsSync(
        replayPath
    )
) {

    throw new Error(
        `Missing replay:\n${replayPath}`
    );
}


if (
    !existsSync(
        typeSummaryPath
    )
) {

    throw new Error(
        `Missing Script 52 output:\n${typeSummaryPath}`
    );
}


// ============================================================
// LOAD TYPE CLASSIFICATION
// ============================================================

const typeSummary =
    JSON.parse(
        readFileSync(
            typeSummaryPath,
            'utf8'
        )
    );


if (
    typeSummary
        ?.validation
        ?.pass !==
    true
) {

    throw new Error(
        'Script 52 did not pass validation.'
    );
}


// ============================================================
// SUBCLASS MAP
// ============================================================

const baseTypeBySubclass =
    new Map();


let transportSubclassId =
    null;


for (
    const row
    of typeSummary
        ?.subclassEvidence
    ??
    []
) {

    const subclassId =
        String(
            row.subclassId
        );


    const baseType =
        row
            ?.classification
            ?.baseType
        ??
        'UNKNOWN';


    baseTypeBySubclass.set(
        subclassId,
        baseType
    );


    const modalHP =
        finite(
            row
                ?.maxHealth
                ?.modalAll
        );


    if (
        baseType ===
            'NON_STANDARD_TROOPER_CANDIDATE'
        &&
        modalHP ===
            1
    ) {

        transportSubclassId =
            subclassId;
    }
}


if (
    !transportSubclassId
) {

    throw new Error(
        'Could not identify the 1-HP non-standard CNPC_Trooper subclass from Script 52.'
    );
}


console.log('');

console.log(
    `1-HP transport candidate subclass: ${transportSubclassId}`
);


// ============================================================
// STATE
// ============================================================

const previousByEntity =
    new Map();


const currentNormalTroopers =
    new Map();


const knownTransportIndexes =
    new Set();


const transportTerminationEvents =
    [];


const normalHandleTransitions =
    [];


let trooperEvents =
    0;


let transportEvents =
    0;


let transportHealthTransitions =
    0;


let transportLifeTransitions =
    0;


let dualSignalTransportTerminations =
    0;


let normalTrooperEvents =
    0;


let directHandleLinksObserved =
    0;


// ============================================================
// SAMPLES
// ============================================================

const rawProxyExamples =
    [];


const parentTransitionExamples =
    [];


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// ENTITY PACKET
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
            of events
            ??
            []
        ) {

            const entity =
                event.entity;


            if (
                !entity
            ) {

                continue;
            }


            if (
                getEntityClassName(
                    entity
                ) !==
                'CNPC_Trooper'
            ) {

                continue;
            }


            processTrooper(
                entity,
                tick
            );
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');

console.log(
    '=========================================='
);

console.log(
    'TROOPER ZIPLINE TRANSPORT VALIDATION'
);

console.log(
    '=========================================='
);

console.log('');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Transport candidate subclass: ${transportSubclassId}`
);

console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


await parser.dispose();


// ============================================================
// CLUSTER TRANSPORT TERMINATIONS
// ============================================================

const clusters =
    clusterTransportEvents(
        transportTerminationEvents
    );


// ============================================================
// SUMMARIZE CLUSTERS
// ============================================================

const clusterRows =
    clusters.map(
        (
            members,
            index
        ) =>
            summarizeCluster(
                members,
                index
            )
    );


// ============================================================
// CLUSTER SIZE DISTRIBUTION
// ============================================================

const clusterSizeDistribution =
    countBy(
        clusterRows,
        row =>
            String(
                row.proxyCount
            )
    );


// ============================================================
// CLUSTER COMPOSITION DISTRIBUTION
// ============================================================

const compositionDistribution =
    countBy(
        clusterRows,
        row =>
            row.nearbyNormalCompositionKey
    );


// ============================================================
// EXPECTED WAVE COMPOSITION TESTS
// ============================================================

let earlyWaveCompositionMatches =
    0;


let earlyWaveCompositionEligible =
    0;


let postFiveCompositionMatches =
    0;


let postFiveCompositionEligible =
    0;


for (
    const cluster
    of clusterRows
) {

    if (
        cluster.timeSeconds <
            0
    ) {

        continue;
    }


    const composition =
        cluster.nearbyNormalTypeCounts;


    if (
        cluster.timeSeconds <
            300
    ) {

        earlyWaveCompositionEligible++;


        if (
            (
                composition.RANGED
                ??
                0
            ) >=
                3
            &&
            (
                composition.MEDIC
                ??
                0
            ) >=
                1
        ) {

            earlyWaveCompositionMatches++;
        }

    } else {

        postFiveCompositionEligible++;


        if (
            (
                composition.RANGED
                ??
                0
            ) >=
                2
            &&
            (
                composition.MEDIC
                ??
                0
            ) >=
                1
            &&
            (
                composition.MELEE
                ??
                0
            ) >=
                1
        ) {

            postFiveCompositionMatches++;
        }
    }
}


// ============================================================
// DIRECT HANDLE LINKS
// ============================================================

const directLinksToKnownTransport =
    normalHandleTransitions.filter(
        row =>
            row.currentParentIsTransport
            ||
            row.previousParentIsTransport
    );


const releasesFromTransport =
    directLinksToKnownTransport.filter(
        row =>
            row.previousParentIsTransport
            &&
            !row.currentParentIsTransport
    );


const attachmentsToTransport =
    directLinksToKnownTransport.filter(
        row =>
            !row.previousParentIsTransport
            &&
            row.currentParentIsTransport
    );


// ============================================================
// RELEASE -> TRANSPORT TERMINATION CORRELATION
// ============================================================

let releasesNearProxyTermination =
    0;


const releaseCorrelations =
    [];


for (
    const release
    of releasesFromTransport
) {

    let best =
        null;


    for (
        const termination
        of transportTerminationEvents
    ) {

        const tickDelta =
            release.tick -
            termination.tick;


        if (
            Math.abs(
                tickDelta
            ) >
            8
        ) {

            continue;
        }


        if (
            release.team !==
                null
            &&
            termination.team !==
                null
            &&
            release.team !==
                termination.team
        ) {

            continue;
        }


        let distance3D =
            null;


        if (
            release.position
            &&
            termination.position
        ) {

            distance3D =
                getDistance3D(
                    release.position,
                    termination.position
                );


            if (
                distance3D >
                1000
            ) {

                continue;
            }
        }


        const score =
            Math.abs(
                tickDelta
            )
            *
            10000
            +
            (
                distance3D
                ??
                0
            );


        if (
            !best
            ||
            score <
                best.score
        ) {

            best =
                {

                    score,

                    transportEntityIndex:
                        termination.entityIndex,

                    transportTick:
                        termination.tick,

                    transportClock:
                        termination.clock,

                    tickDelta,

                    distance3D
                };
        }
    }


    if (
        best
    ) {

        releasesNearProxyTermination++;


        if (
            releaseCorrelations.length <
            MAX_PARENT_TRANSITION_EXAMPLES
        ) {

            releaseCorrelations.push({

                ...release,

                matchedTransportTermination:
                    best
            });
        }
    }
}


// ============================================================
// BASIC TIME DISTRIBUTION
// ============================================================

const clusterTimes =
    clusterRows

        .map(
            row =>
                row.timeSeconds
        )

        .filter(
            value =>
                value >=
                0
        )

        .sort(
            (
                a,
                b
            ) =>
                a -
                b
        );


// ============================================================
// INTER-CLUSTER INTERVALS BY TEAM/LANE
// ============================================================

const intervals =
    [];


const byTeamLane =
    new Map();


for (
    const cluster
    of clusterRows
) {

    const key =
        `${cluster.team}|${cluster.lane}`;


    if (
        !byTeamLane.has(
            key
        )
    ) {

        byTeamLane.set(
            key,
            []
        );
    }


    byTeamLane
        .get(
            key
        )
        .push(
            cluster
        );
}


for (
    const [
        key,
        rows
    ]
    of byTeamLane.entries()
) {

    rows.sort(
        (
            a,
            b
        ) =>
            a.timeSeconds -
            b.timeSeconds
    );


    for (
        let i =
            1;

        i <
            rows.length;

        i++
    ) {

        const seconds =
            rows[i].timeSeconds -
            rows[
                i -
                1
            ].timeSeconds;


        if (
            seconds >
            0
        ) {

            intervals.push(
                seconds
            );
        }
    }
}


// ============================================================
// WRITE EVENT STREAM
// ============================================================

mkdirSync(
    dirname(
        outputEventsPath
    ),
    {
        recursive: true
    }
);


const writer =
    createWriteStream(
        outputEventsPath,
        {
            encoding:
                'utf8'
        }
    );


for (
    const cluster
    of clusterRows
) {

    writer.write(
        JSON.stringify(
            cluster
        )
        +
        '\n'
    );
}


await finishWriter(
    writer
);


// ============================================================
// VALIDATION
// ============================================================

const modalClusterSize =
    modeNumber(
        clusterRows.map(
            row =>
                row.proxyCount
        )
    );


const clustersWithNearbyNormals =
    clusterRows.filter(
        row =>
            row.nearbyNormalTrooperCount >
            0
    ).length;


const clustersWithAtLeastFourNormals =
    clusterRows.filter(
        row =>
            row.nearbyNormalTrooperCount >=
            4
    ).length;


const validation =
    {

        script52Passed:
            {

                actual:
                    typeSummary
                        ?.validation
                        ?.pass,

                expected:
                    true,

                pass:
                    typeSummary
                        ?.validation
                        ?.pass ===
                    true
            },

        oneHpSubclassIdentified:
            {

                actual:
                    transportSubclassId,

                expected:
                    'non-null',

                pass:
                    Boolean(
                        transportSubclassId
                    )
            },

        transportEventsObserved:
            {

                actual:
                    transportEvents,

                expected:
                    '>0',

                pass:
                    transportEvents >
                    0
            },

        transportTerminationsObserved:
            {

                actual:
                    transportTerminationEvents.length,

                expected:
                    '>0',

                pass:
                    transportTerminationEvents.length >
                    0
            },

        dualDeathSignalOnTransport:
            {

                actual:
                    dualSignalTransportTerminations,

                expected:
                    transportTerminationEvents.length,

                pass:
                    dualSignalTransportTerminations ===
                    transportTerminationEvents.length
            },

        clusteredTransportTerminations:
            {

                actual:
                    clusterRows.length,

                expected:
                    '>0',

                pass:
                    clusterRows.length >
                    0
            },

        synchronizedMultiProxyClusters:
            {

                actual:
                    clusterRows.filter(
                        row =>
                            row.proxyCount >
                            1
                    ).length,

                expected:
                    '>0',

                pass:
                    clusterRows.some(
                        row =>
                            row.proxyCount >
                            1
                    )
            },

        normalTroopersNearDismounts:
            {

                actual:
                    clustersWithNearbyNormals,

                expected:
                    '>0',

                pass:
                    clustersWithNearbyNormals >
                    0
            }
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
// INTERPRETATION
// ============================================================

let interpretation =
    'UNRESOLVED_1HP_TROOPER_HELPER';


if (
    validationPass
    &&
    clusterRows.some(
        row =>
            row.proxyCount >
            1
    )
    &&
    clustersWithNearbyNormals >
        0
) {

    interpretation =
        'ZIPLINE_TRANSPORT_PROXY_STRONGLY_SUPPORTED';
}


if (
    directLinksToKnownTransport.length >
    0
) {

    interpretation =
        'ZIPLINE_TRANSPORT_PROXY_DIRECT_HANDLE_EVIDENCE';
}


// ============================================================
// SUMMARY
// ============================================================

const summary =
    {

        replay:
            replayName,

        version:
            'TROOPER_ZIPLINE_TRANSPORT_VALIDATION',

        canonical:
            false,

        transportSubclassId,

        userMechanicPremise:
            {

                description:
                    'Non-Super lane Troopers travel by zipline to the furthest captured lane point. Shooting any Trooper on the zipline once causes the transported group to fall and continue normally from that location.',

                consequenceForTelemetry:
                    'The 1-HP CNPC_Trooper subclass should be tested as a transport/rider proxy whose 1->0 transition represents dismount/transport termination rather than economic Trooper death.'
            },

        sourceCounts:
            {

                trooperEvents,

                normalTrooperEvents,

                transportEvents,

                transportEntityIndexes:
                    knownTransportIndexes.size,

                transportHealthTransitions,

                transportLifeTransitions,

                dualSignalTransportTerminations,

                rawTransportTerminationEvents:
                    transportTerminationEvents.length,

                clusters:
                    clusterRows.length
            },

        clusterStructure:
            {

                clusterMaxTickGap:
                    CLUSTER_MAX_TICK_GAP,

                clusterMaxDistance3D:
                    CLUSTER_MAX_DISTANCE_3D,

                sizeDistribution:
                    mapToNumericKeyObject(
                        clusterSizeDistribution
                    ),

                modalClusterSize,

                multiProxyClusters:
                    clusterRows.filter(
                        row =>
                            row.proxyCount >
                            1
                    ).length,

                clustersWithNearbyNormalTroopers:
                    clustersWithNearbyNormals,

                clustersWithAtLeastFourNearbyNormalTroopers:
                    clustersWithAtLeastFourNormals,

                nearbyCompositionDistribution:
                    mapToSortedObject(
                        compositionDistribution
                    ),

                interClusterIntervalSeconds:
                    summarizeNumbers(
                        intervals
                    )
            },

        expectedWaveCompositionCrosscheck:
            {

                beforeFiveMinutes:
                    {

                        expected:
                            'approximately 3 Ranged + 1 Medic',

                        eligibleClusters:
                            earlyWaveCompositionEligible,

                        clustersContainingExpectedMinimum:
                            earlyWaveCompositionMatches,

                        rate:
                            rate(
                                earlyWaveCompositionMatches,
                                earlyWaveCompositionEligible
                            )
                    },

                afterFiveMinutes:
                    {

                        expected:
                            'approximately 2 Ranged + 1 Medic + 1 Melee',

                        eligibleClusters:
                            postFiveCompositionEligible,

                        clustersContainingExpectedMinimum:
                            postFiveCompositionMatches,

                        rate:
                            rate(
                                postFiveCompositionMatches,
                                postFiveCompositionEligible
                            )
                    },

                caveat:
                    'Nearby-state association is diagnostic only because multiple waves, fights, and stale/persistent entity positions can occur in the same area.'
            },

        directHandleEvidence:
            {

                fieldsChecked:
                    HANDLE_FIELDS,

                handleTransitionsObserved:
                    normalHandleTransitions.length,

                transitionsReferencingKnownTransportIndex:
                    directLinksToKnownTransport.length,

                attachmentsToTransport,

                releasesFromTransport:
                    releasesFromTransport.length,

                releasesNearProxyTermination,

                releaseTerminationCorrelationRate:
                    rate(
                        releasesNearProxyTermination,
                        releasesFromTransport.length
                    ),

                examples:
                    releaseCorrelations
            },

        interpretation:
            {

                result:
                    interpretation,

                economicHandling:
                    'Exclude this subclass from Trooper kill/death/soul denominators.',

                behavioralHandling:
                    'Retain it as a lane-mobility/transport state because proxy termination can mark where a wave becomes grounded and interactable.',

                futureResponseClasses:
                    [
                        'ZIPLINE_TRANSPORT_ACTIVE',
                        'ZIPLINE_NATURAL_DISMOUNT',
                        'ZIPLINE_SHOT_DOWN_DISMOUNT'
                    ],

                importantSuperException:
                    'If Super Troopers do not use the zipline transport proxy, transport presence/absence becomes an additional independent clue for Super classification.',

                nextNeededDistinction:
                    'Separate natural zipline arrival from player-caused shoot-down. Bullet-ray/damage telemetry can later be aligned to these proxy termination cohorts.'
            },

        examples:
            {

                rawTransportTerminations:
                    rawProxyExamples,

                normalParentTransitions:
                    parentTransitionExamples,

                clusters:
                    clusterRows.slice(
                        0,
                        MAX_CLUSTER_EXAMPLES
                    )
            },

        validation:
            {

                pass:
                    validationPass,

                checks:
                    validation
            },

        outputs:
            {

                dismountClusters:
                    outputEventsPath
            }
    };


// ============================================================
// WRITE SUMMARY
// ============================================================

mkdirSync(
    dirname(
        outputSummaryPath
    ),
    {
        recursive: true
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


// ============================================================
// CONSOLE
// ============================================================

console.log('');

console.log(
    '1-HP TRANSPORT CANDIDATE'
);

console.log(
    '------------------------'
);

console.log(
    `Subclass: ${transportSubclassId}`
);

console.log(
    `Entity events: ${transportEvents.toLocaleString()}`
);

console.log(
    `Unique entity indexes: ${knownTransportIndexes.size}`
);

console.log(
    `1 -> 0 terminations: ${transportTerminationEvents.length}`
);

console.log('');

console.log(
    'DISMOUNT CLUSTERS'
);

console.log(
    '-----------------'
);

console.log(
    `Clusters: ${clusterRows.length}`
);

console.log(
    `Modal proxy count: ${modalClusterSize}`
);

console.log(
    `Multi-proxy clusters: ${
        clusterRows.filter(
            row =>
                row.proxyCount >
                1
        ).length
    }`
);

console.log(
    `Clusters with nearby normal Troopers: ${clustersWithNearbyNormals}`
);

console.log(
    `Clusters with >=4 nearby normal Troopers: ${clustersWithAtLeastFourNormals}`
);

console.log('');

console.log(
    'CLUSTER SIZE DISTRIBUTION'
);

console.log(
    '-------------------------'
);


for (
    const [
        size,
        count
    ]
    of Object.entries(
        mapToNumericKeyObject(
            clusterSizeDistribution
        )
    )
) {

    console.log(
        `size=${String(
            size
        ).padStart(
            3
        )}  clusters=${count}`
    );
}


console.log('');

console.log(
    'DIRECT HANDLE EVIDENCE'
);

console.log(
    '----------------------'
);

console.log(
    `Normal handle transitions: ${normalHandleTransitions.length}`
);

console.log(
    `Transitions referencing transport index: ${directLinksToKnownTransport.length}`
);

console.log(
    `Attachments to transport: ${attachmentsToTransport.length}`
);

console.log(
    `Releases from transport: ${releasesFromTransport.length}`
);

console.log(
    `Releases near proxy termination: ${releasesNearProxyTermination}`
);

console.log('');

console.log(
    'EXPECTED WAVE COMPOSITION'
);

console.log(
    '-------------------------'
);

console.log(
    `Before 5:00: ${earlyWaveCompositionMatches}/${earlyWaveCompositionEligible} clusters contain >=3 Ranged + >=1 Medic`
);

console.log(
    `After 5:00: ${postFiveCompositionMatches}/${postFiveCompositionEligible} clusters contain >=2 Ranged + >=1 Medic + >=1 Melee`
);

console.log('');

console.log(
    'INTERPRETATION'
);

console.log(
    '--------------'
);

console.log(
    interpretation
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
                38
            )
        } actual=${
            JSON.stringify(
                check.actual
            )
        } expected=${
            JSON.stringify(
                check.expected
            )
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
    `Dismount clusters:\n${outputEventsPath}`
);

console.log('');


// ============================================================
// PROCESS TROOPER
// ============================================================

function processTrooper(
    entity,
    tick
) {

    trooperEvents++;


    if (
        trooperEvents %
            PROGRESS_EVERY_TROOPER_EVENTS ===
        0
    ) {

        console.log(
            `Trooper events: ${
                trooperEvents.toLocaleString()
            } | transport terminations=${
                transportTerminationEvents.length
            }`
        );
    }


    const entityIndex =
        getEntityIndex(
            entity
        );


    if (
        entityIndex ===
        null
    ) {

        return;
    }


    const subclassId =
        String(
            serializeScalar(
                safeGetField(
                    entity,
                    'm_nSubclassID'
                )
            )
            ??
            'UNKNOWN'
        );


    const baseType =
        baseTypeBySubclass.get(
            subclassId
        )
        ??
        'UNKNOWN';


    const current =
        {

            entityIndex,

            subclassId,

            baseType,

            health:
                finite(
                    safeGetField(
                        entity,
                        'm_iHealth'
                    )
                ),

            maxHealth:
                finite(
                    safeGetField(
                        entity,
                        'm_iMaxHealth'
                    )
                ),

            lifeState:
                finite(
                    safeGetField(
                        entity,
                        'm_lifeState'
                    )
                ),

            team:
                finite(
                    safeGetField(
                        entity,
                        'm_iTeamNum'
                    )
                ),

            lane:
                finite(
                    safeGetField(
                        entity,
                        'm_iLane'
                    )
                ),

            position:
                getWorldPosition(
                    entity
                ),

            handles:
                readHandles(
                    entity
                )
        };


    const previous =
        previousByEntity.get(
            entityIndex
        )
        ??
        null;


    // ========================================================
    // TRANSPORT PROXY
    // ========================================================

    if (
        subclassId ===
        transportSubclassId
    ) {

        transportEvents++;


        knownTransportIndexes.add(
            entityIndex
        );


        if (
            previous
        ) {

            const healthTermination =
                previous.health !==
                    null
                &&
                current.health !==
                    null
                &&
                previous.health >
                    0
                &&
                current.health <=
                    0;


            const lifeTermination =
                previous.lifeState !==
                    null
                &&
                current.lifeState !==
                    null
                &&
                previous.lifeState ===
                    0
                &&
                current.lifeState !==
                    0;


            if (
                healthTermination
            ) {

                transportHealthTransitions++;
            }


            if (
                lifeTermination
            ) {

                transportLifeTransitions++;
            }


            if (
                healthTermination
                &&
                lifeTermination
            ) {

                dualSignalTransportTerminations++;


                const row =
                    {

                        entityIndex,

                        tick,

                        timeSeconds:
                            tickToMatchTime(
                                tick
                            ),

                        clock:
                            formatClock(
                                tickToMatchTime(
                                    tick
                                )
                            ),

                        team:
                            current.team
                            ??
                            previous.team,

                        lane:
                            current.lane
                            ??
                            previous.lane,

                        previousHealth:
                            previous.health,

                        currentHealth:
                            current.health,

                        maxHealth:
                            current.maxHealth
                            ??
                            previous.maxHealth,

                        position:
                            current.position
                            ??
                            previous.position,

                        nearbyNormalTroopers:
                            findNearbyNormalTroopers(
                                current.team
                                ??
                                previous.team,

                                current.lane
                                ??
                                previous.lane,

                                current.position
                                ??
                                previous.position
                            )
                    };


                transportTerminationEvents.push(
                    row
                );


                if (
                    rawProxyExamples.length <
                    MAX_RAW_PROXY_EXAMPLES
                ) {

                    rawProxyExamples.push(
                        row
                    );
                }
            }
        }


        previousByEntity.set(
            entityIndex,
            current
        );


        return;
    }


    // ========================================================
    // NORMAL TROOPER
    // ========================================================

    if (
        baseType ===
            'RANGED'
        ||
        baseType ===
            'MEDIC'
        ||
        baseType ===
            'MELEE'
    ) {

        normalTrooperEvents++;


        if (
            current.health !==
                null
            &&
            current.health >
                0
            &&
            current.lifeState ===
                0
        ) {

            currentNormalTroopers.set(
                entityIndex,
                current
            );

        } else {

            currentNormalTroopers.delete(
                entityIndex
            );
        }


        // ====================================================
        // HANDLE TRANSITIONS
        // ====================================================

        if (
            previous
        ) {

            for (
                const fieldName
                of HANDLE_FIELDS
            ) {

                const previousHandle =
                    previous
                        ?.handles
                        ?.[
                            fieldName
                        ]
                    ??
                    null;


                const currentHandle =
                    current
                        ?.handles
                        ?.[
                            fieldName
                        ]
                    ??
                    null;


                if (
                    previousHandle ===
                    currentHandle
                ) {

                    continue;
                }


                const previousParentIndex =
                    decodeHandleEntityIndex(
                        previousHandle
                    );


                const currentParentIndex =
                    decodeHandleEntityIndex(
                        currentHandle
                    );


                const previousParentIsTransport =
                    previousParentIndex !==
                        null
                    &&
                    knownTransportIndexes.has(
                        previousParentIndex
                    );


                const currentParentIsTransport =
                    currentParentIndex !==
                        null
                    &&
                    knownTransportIndexes.has(
                        currentParentIndex
                    );


                const transition =
                    {

                        tick,

                        timeSeconds:
                            tickToMatchTime(
                                tick
                            ),

                        clock:
                            formatClock(
                                tickToMatchTime(
                                    tick
                                )
                            ),

                        trooperEntityIndex:
                            entityIndex,

                        baseType,

                        subclassId,

                        team:
                            current.team,

                        lane:
                            current.lane,

                        position:
                            current.position,

                        fieldName,

                        previousHandle,

                        currentHandle,

                        previousParentIndex,

                        currentParentIndex,

                        previousParentIsTransport,

                        currentParentIsTransport
                    };


                normalHandleTransitions.push(
                    transition
                );


                if (
                    previousParentIsTransport
                    ||
                    currentParentIsTransport
                ) {

                    directHandleLinksObserved++;
                }


                if (
                    parentTransitionExamples.length <
                    MAX_PARENT_TRANSITION_EXAMPLES
                ) {

                    parentTransitionExamples.push(
                        transition
                    );
                }
            }
        }
    }


    previousByEntity.set(
        entityIndex,
        current
    );
}


// ============================================================
// FIND NEARBY NORMAL TROOPERS
// ============================================================

function findNearbyNormalTroopers(
    team,
    lane,
    position
) {

    if (
        !position
    ) {

        return [];
    }


    const rows =
        [];


    for (
        const normal
        of currentNormalTroopers.values()
    ) {

        if (
            team !==
                null
            &&
            normal.team !==
                null
            &&
            normal.team !==
                team
        ) {

            continue;
        }


        if (
            lane !==
                null
            &&
            normal.lane !==
                null
            &&
            normal.lane !==
                lane
        ) {

            continue;
        }


        if (
            !normal.position
        ) {

            continue;
        }


        const distance3D =
            getDistance3D(
                position,
                normal.position
            );


        if (
            distance3D >
            NEARBY_NORMAL_RADIUS
        ) {

            continue;
        }


        rows.push({

            entityIndex:
                normal.entityIndex,

            subclassId:
                normal.subclassId,

            baseType:
                normal.baseType,

            team:
                normal.team,

            lane:
                normal.lane,

            health:
                normal.health,

            maxHealth:
                normal.maxHealth,

            distance3D,

            position:
                normal.position
        });
    }


    return rows

        .sort(
            (
                a,
                b
            ) =>
                a.distance3D -
                b.distance3D
        )

        .slice(
            0,
            MAX_NEARBY_NORMALS_PER_PROXY
        );
}


// ============================================================
// CLUSTER TRANSPORT EVENTS
// ============================================================

function clusterTransportEvents(
    events
) {

    const sorted =
        [
            ...events
        ]
        .sort(
            (
                a,
                b
            ) =>
                a.tick -
                b.tick
        );


    const clusters =
        [];


    for (
        const event
        of sorted
    ) {

        let bestCluster =
            null;


        let bestScore =
            Infinity;


        for (
            const cluster
            of clusters
    ) {

            const last =
                cluster[
                    cluster.length -
                    1
                ];


            const tickGap =
                event.tick -
                last.tick;


            if (
                tickGap <
                    0
                ||
                tickGap >
                    CLUSTER_MAX_TICK_GAP
            ) {

                continue;
            }


            if (
                event.team !==
                    null
                &&
                last.team !==
                    null
                &&
                event.team !==
                    last.team
            ) {

                continue;
            }


            if (
                event.lane !==
                    null
                &&
                last.lane !==
                    null
                &&
                event.lane !==
                    last.lane
            ) {

                continue;
            }


            let distance =
                0;


            if (
                event.position
                &&
                last.position
            ) {

                distance =
                    getDistance3D(
                        event.position,
                        last.position
                    );


                if (
                    distance >
                    CLUSTER_MAX_DISTANCE_3D
                ) {

                    continue;
                }
            }


            const score =
                tickGap *
                10000
                +
                distance;


            if (
                score <
                bestScore
            ) {

                bestScore =
                    score;


                bestCluster =
                    cluster;
            }
        }


        if (
            bestCluster
        ) {

            bestCluster.push(
                event
            );

        } else {

            clusters.push(
                [
                    event
                ]
            );
        }
    }


    return clusters;
}


// ============================================================
// SUMMARIZE CLUSTER
// ============================================================

function summarizeCluster(
    members,
    index
) {

    const sorted =
        [
            ...members
        ]
        .sort(
            (
                a,
                b
            ) =>
                a.tick -
                b.tick
        );


    const first =
        sorted[0];


    const last =
        sorted[
            sorted.length -
            1
        ];


    const centroid =
        centroidOfPositions(
            sorted
                .map(
                    row =>
                        row.position
                )
                .filter(
                    Boolean
                )
        );


    // ========================================================
    // DEDUPLICATE NEARBY NORMAL TROOPERS
    // ========================================================

    const nearbyByEntity =
        new Map();


    for (
        const member
        of sorted
    ) {

        for (
            const normal
            of member.nearbyNormalTroopers
            ??
            []
        ) {

            const existing =
                nearbyByEntity.get(
                    normal.entityIndex
                );


            if (
                !existing
                ||
                normal.distance3D <
                    existing.distance3D
            ) {

                nearbyByEntity.set(
                    normal.entityIndex,
                    normal
                );
            }
        }
    }


    const nearbyNormals =
        [
            ...nearbyByEntity.values()
        ]
        .sort(
            (
                a,
                b
            ) =>
                a.distance3D -
                b.distance3D
        );


    const typeCounts =
        mapToSortedObject(
            countBy(
                nearbyNormals,
                row =>
                    row.baseType
            )
        );


    const compositionKey =
        makeCompositionKey(
            typeCounts
        );


    return {

        schemaVersion:
            1,

        canonical:
            false,

        eventId:
            `ZIP_DISMOUNT_${
                String(
                    index +
                    1
                ).padStart(
                    4,
                    '0'
                )
            }`,

        team:
            first.team,

        lane:
            first.lane,

        firstTick:
            first.tick,

        lastTick:
            last.tick,

        tickSpan:
            last.tick -
            first.tick,

        timeSeconds:
            first.timeSeconds,

        clock:
            first.clock,

        proxyCount:
            sorted.length,

        transportEntityIndexes:
            sorted.map(
                row =>
                    row.entityIndex
            ),

        centroid,

        memberPositions:
            sorted.map(
                row =>
                    row.position
            ),

        nearbyNormalTrooperCount:
            nearbyNormals.length,

        nearbyNormalTypeCounts:
            typeCounts,

        nearbyNormalCompositionKey:
            compositionKey,

        nearbyNormalTroopers:
            nearbyNormals,

        interpretation:
            'ZIPLINE_DISMOUNT_CANDIDATE'
    };
}


// ============================================================
// COMPOSITION KEY
// ============================================================

function makeCompositionKey(
    counts
) {

    return [
        `R${counts.RANGED ?? 0}`,
        `M${counts.MEDIC ?? 0}`,
        `L${counts.MELEE ?? 0}`
    ].join(
        '-'
    );
}


// ============================================================
// HANDLES
// ============================================================

function readHandles(
    entity
) {

    const output =
        {};


    for (
        const fieldName
        of HANDLE_FIELDS
    ) {

        output[
            fieldName
        ] =
            handleOrNull(
                safeGetField(
                    entity,
                    fieldName
                )
            );
    }


    return output;
}


function handleOrNull(
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


    try {

        return BigInt(
            value
        ).toString();

    } catch {

        return null;
    }
}


function decodeHandleEntityIndex(
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

        const value =
            BigInt(
                handle
            );


        if (
            value <=
                0n
            ||
            value ===
                16777215n
        ) {

            return null;
        }


        return Number(
            value
            &
            BigInt(
                ENTITY_INDEX_MASK
            )
        );

    } catch {

        return null;
    }
}


// ============================================================
// POSITION
// ============================================================

function getWorldPosition(
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


function getDistance3D(
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


function centroidOfPositions(
    positions
) {

    if (
        positions.length ===
        0
    ) {

        return null;
    }


    return {

        x:
            average(
                positions.map(
                    row =>
                        row.x
                )
            ),

        y:
            average(
                positions.map(
                    row =>
                        row.y
                )
            ),

        z:
            average(
                positions.map(
                    row =>
                        row.z
                )
            )
    };
}


// ============================================================
// FIELD ACCESS
// ============================================================

function safeGetField(
    entity,
    fieldName
) {

    try {

        if (
            typeof entity.getField ===
            'function'
        ) {

            return entity.getField(
                fieldName
            );
        }

    } catch {

        // Missing field.
    }


    return undefined;
}


// ============================================================
// ENTITY CLASS
// ============================================================

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

    } catch {

        // Fall through.
    }


    return (
        entity.className
        ??
        entity
            ?.class
            ?.name
        ??
        entity
            ?._className
        ??
        null
    );
}


// ============================================================
// ENTITY INDEX
// ============================================================

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

        if (
            typeof entity.getIndex ===
            'function'
        ) {

            return finite(
                entity.getIndex()
            );
        }

    } catch {

        // Fall through.
    }


    return null;
}


// ============================================================
// COUNTS
// ============================================================

function countBy(
    rows,
    keyFn
) {

    const result =
        new Map();


    for (
        const row
        of rows
    ) {

        increment(
            result,
            keyFn(
                row
            )
        );
    }


    return result;
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
        )
    );
}


function mapToNumericKeyObject(
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
// MODE
// ============================================================

function modeNumber(
    values
) {

    const counts =
        new Map();


    for (
        const value
        of values
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            continue;
        }


        increment(
            counts,
            value
        );
    }


    if (
        counts.size ===
        0
    ) {

        return null;
    }


    return [
        ...counts.entries()
    ]
        .sort(
            (
                a,
                b
            ) =>
                b[1] -
                a[1]
                ||
                a[0] -
                b[0]
        )[0][0];
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


    const total =
        clean.reduce(
            (
                sum,
                value
            ) =>
                sum +
                value,
            0
        );


    return {

        count:
            clean.length,

        min:
            clean[0],

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
            total /
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
        )
        *
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
    MATCH_CLOCK_OFFSET_SECONDS;
}


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


function average(
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


// ============================================================
// FINISH WRITER
// ============================================================

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