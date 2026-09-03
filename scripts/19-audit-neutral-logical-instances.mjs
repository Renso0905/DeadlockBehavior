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

const SAMPLE_EVERY_TICKS =
    4;

const TICK_RATE =
    64;

const MATCH_OFFSET =
    30;

const CREATE_TIME_TOLERANCE =
    0.10;

const SPAWN_GROUP_XY_RADIUS =
    600;

const SPAWN_GROUP_Z_RADIUS =
    160;

const SAME_SITE_XY_RADIUS =
    450;

const SAME_SITE_Z_RADIUS =
    192;


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );


const instanceOutputPath =
    resolve(
        'output',
        replayName,
        'neutral_logical_instances.json'
    );


const cohortOutputPath =
    resolve(
        'output',
        replayName,
        'neutral_spawn_cohorts.json'
    );


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// LOGICAL INSTANCES
//
// IMPORTANT:
//
// entityIndex alone is NOT our identity.
//
// logical key:
// entityIndex + m_flCreateTime
// ============================================================

const instances =
    new Map();


// ============================================================
// PARSE REPLAY
// ============================================================

console.log('');
console.log(
    'Auditing neutral logical instances...'
);
console.log('');


parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            Number(
                demoPacket.tick
            );


        if (
            !Number.isFinite(
                tick
            )
            ||
            tick %
            SAMPLE_EVERY_TICKS
            !==
            0
        ) {

            return;
        }


        const matchTime =
            (
                tick /
                TICK_RATE
            )
            -
            MATCH_OFFSET;


        const demo =
            parser.getDemo();


        const neutrals =
            demo.getEntitiesByClassName(
                'CNPC_TrooperNeutral'
            );


        for (
            const neutral
            of neutrals
        ) {

            const entityIndex =
                Number(
                    neutral.index
                );


            const createTime =
                numberField(
                    neutral,
                    'm_flCreateTime'
                );


            if (
                !Number.isFinite(
                    entityIndex
                )
                ||
                !Number.isFinite(
                    createTime
                )
            ) {

                continue;
            }


            const key =
                `${entityIndex}|${createTime}`;


            const health =
                numberField(
                    neutral,
                    'm_iHealth'
                );


            const maxHealth =
                numberField(
                    neutral,
                    'm_iMaxHealth'
                );


            const lifeState =
                numberField(
                    neutral,
                    'm_lifeState'
                );


            const npcState =
                numberField(
                    neutral,
                    'm_NPCState'
                );


            const subclassId =
                numberField(
                    neutral,
                    'm_nSubclassID'
                );


            const position =
                worldPosition(
                    neutral
                );


            if (
                !instances.has(
                    key
                )
            ) {

                instances.set(
                    key,
                    {

                        logicalKey:
                            key,

                        entityIndex,

                        createTime,

                        subclassId,

                        unitType:
                            classifySubclass(
                                subclassId
                            ),

                        firstObservedTick:
                            tick,

                        firstObservedMatchTimeSeconds:
                            matchTime,

                        firstObservedPosition:
                            position,

                        firstHealth:
                            health,

                        firstMaxHealth:
                            maxHealth,

                        firstLifeState:
                            lifeState,

                        firstNpcState:
                            npcState,

                        deathObserved:
                            false,

                        deathTick:
                            null,

                        deathMatchTimeSeconds:
                            null,

                        deathPosition:
                            null,

                        lastObservedTick:
                            tick,

                        lastObservedMatchTimeSeconds:
                            matchTime,

                        observationCount:
                            1
                    }
                );


                continue;
            }


            const instance =
                instances.get(
                    key
                );


            instance.lastObservedTick =
                tick;

            instance.lastObservedMatchTimeSeconds =
                matchTime;

            instance.observationCount++;


            // =================================================
            // DEATH
            //
            // We only label a death once for THIS logical
            // instance.
            // =================================================

            const dead =
                (
                    Number.isFinite(
                        health
                    )
                    &&
                    health <= 0
                )
                ||
                lifeState === 1;


            if (
                dead
                &&
                !instance.deathObserved
            ) {

                instance.deathObserved =
                    true;

                instance.deathTick =
                    tick;

                instance.deathMatchTimeSeconds =
                    matchTime;

                instance.deathPosition =
                    position;
            }
        }
    }
);


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FORMAT INSTANCES
// ============================================================

const logicalInstances =
    [...instances.values()]

        .sort(
            (
                a,
                b
            ) =>
                a.createTime -
                b.createTime
                ||
                a.entityIndex -
                b.entityIndex
        );


// ============================================================
// GROUP BY CREATION TIME
//
// First group new logical instances that the server created
// at effectively the same time.
// ============================================================

const createTimeCohorts =
    clusterByCreateTime(
        logicalInstances,
        CREATE_TIME_TOLERANCE
    );


// ============================================================
// SPATIAL SPLIT
//
// Several camps can spawn at the same server time.
//
// Split each create-time cohort spatially.
// ============================================================

const spawnGroups =
    [];


let spawnGroupNumber =
    1;


for (
    const cohort
    of createTimeCohorts
) {

    const spatialGroups =
        connectedComponents(
            cohort.instances,
            SPAWN_GROUP_XY_RADIUS,
            SPAWN_GROUP_Z_RADIUS
        );


    for (
        const members
        of spatialGroups
    ) {

        const center =
            centroid(
                members
            );


        const deaths =
            members

                .map(
                    member =>
                        member
                            .deathMatchTimeSeconds
                )

                .filter(
                    Number.isFinite
                );


        const fullyKilled =
            deaths.length ===
            members.length;


        const clearTime =
            fullyKilled

                ? Math.max(
                    ...deaths
                )

                : null;


        spawnGroups.push({

            spawnGroupId:
                `SPAWN_${String(
                    spawnGroupNumber++
                ).padStart(
                    4,
                    '0'
                )}`,

            rawCreateTimeMin:
                cohort.minCreateTime,

            rawCreateTimeMax:
                cohort.maxCreateTime,

            rawCreateTimeMean:
                average(
                    members.map(
                        member =>
                            member.createTime
                    )
                ),

            firstObservedMatchTimeSeconds:
                Math.min(
                    ...members.map(
                        member =>
                            member
                                .firstObservedMatchTimeSeconds
                    )
                ),

            centroid:
                center,

            memberCount:
                members.length,

            entityIndexes:
                members.map(
                    member =>
                        member.entityIndex
                ),

            logicalKeys:
                members.map(
                    member =>
                        member.logicalKey
                ),

            unitTypeCounts:
                countValues(
                    members.map(
                        member =>
                            member.unitType
                    )
                ),

            members:
                members.map(
                    member => ({

                        logicalKey:
                            member.logicalKey,

                        entityIndex:
                            member.entityIndex,

                        createTime:
                            member.createTime,

                        unitType:
                            member.unitType,

                        position:
                            member
                                .firstObservedPosition,

                        deathObserved:
                            member.deathObserved,

                        deathMatchTimeSeconds:
                            member
                                .deathMatchTimeSeconds
                    })
                ),

            fullyKilled,

            clearMatchTimeSeconds:
                clearTime,

            nextSpawnAtSameSite:
                null
        });
    }
}


// ============================================================
// SORT SPAWN GROUPS CHRONOLOGICALLY
// ============================================================

spawnGroups.sort(
    (
        a,
        b
    ) =>
        a.rawCreateTimeMean -
        b.rawCreateTimeMean
);


// ============================================================
// FIND NEXT SPAWN AT SAME PHYSICAL SITE
//
// This is deliberately diagnostic.
//
// We do NOT yet assume it is the same camp.
// ============================================================

for (
    let i = 0;
    i < spawnGroups.length;
    i++
) {

    const current =
        spawnGroups[i];


    let best =
        null;


    for (
        let j = i + 1;
        j < spawnGroups.length;
        j++
    ) {

        const candidate =
            spawnGroups[j];


        const xy =
            distanceXY(
                current.centroid,
                candidate.centroid
            );


        const dz =
            Math.abs(
                current.centroid.z -
                candidate.centroid.z
            );


        if (
            xy >
            SAME_SITE_XY_RADIUS
            ||
            dz >
            SAME_SITE_Z_RADIUS
        ) {

            continue;
        }


        best = {

            spawnGroupId:
                candidate.spawnGroupId,

            centroidDistanceXY:
                xy,

            centroidDistanceZ:
                dz,

            nextFirstObservedMatchTimeSeconds:
                candidate
                    .firstObservedMatchTimeSeconds,

            nextCreateTime:
                candidate
                    .rawCreateTimeMean,

            nextMemberCount:
                candidate.memberCount,

            nextEntityIndexes:
                candidate.entityIndexes
        };


        if (
            Number.isFinite(
                current.clearMatchTimeSeconds
            )
        ) {

            best.secondsAfterFullClear =
                candidate
                    .firstObservedMatchTimeSeconds
                -
                current
                    .clearMatchTimeSeconds;
        }


        break;
    }


    current.nextSpawnAtSameSite =
        best;
}


// ============================================================
// SUMMARIES
// ============================================================

const createTimeValues =
    logicalInstances.map(
        instance =>
            instance.createTime
    );


const respawnDelayCandidates =
    spawnGroups

        .filter(
            group =>
                group.fullyKilled
                &&
                group
                    .nextSpawnAtSameSite
                &&
                Number.isFinite(
                    group
                        .nextSpawnAtSameSite
                        .secondsAfterFullClear
                )
        )

        .map(
            group => ({

                spawnGroupId:
                    group.spawnGroupId,

                memberCount:
                    group.memberCount,

                unitTypeCounts:
                    group.unitTypeCounts,

                centroid:
                    group.centroid,

                clearMatchTimeSeconds:
                    group
                        .clearMatchTimeSeconds,

                nextSpawnGroupId:
                    group
                        .nextSpawnAtSameSite
                        .spawnGroupId,

                centroidDistanceXY:
                    group
                        .nextSpawnAtSameSite
                        .centroidDistanceXY,

                secondsAfterFullClear:
                    group
                        .nextSpawnAtSameSite
                        .secondsAfterFullClear
            })
        );


const instanceOutput = {

    replay:
        replayName,

    identityRule:
        'entityIndex + m_flCreateTime',

    uniqueEntityIndexes:
        new Set(
            logicalInstances.map(
                instance =>
                    instance.entityIndex
            )
        ).size,

    logicalInstanceCount:
        logicalInstances.length,

    createTimeStatistics:
        summarize(
            createTimeValues
        ),

    logicalInstances
};


const cohortOutput = {

    replay:
        replayName,

    identityRule:
        'entityIndex + m_flCreateTime',

    parameters: {

        sampleEveryTicks:
            SAMPLE_EVERY_TICKS,

        createTimeToleranceSeconds:
            CREATE_TIME_TOLERANCE,

        spawnGroupXYRadius:
            SPAWN_GROUP_XY_RADIUS,

        spawnGroupZRadius:
            SPAWN_GROUP_Z_RADIUS,

        sameSiteXYRadius:
            SAME_SITE_XY_RADIUS,

        sameSiteZRadius:
            SAME_SITE_Z_RADIUS
    },

    logicalInstanceCount:
        logicalInstances.length,

    rawCreateTimeCohortCount:
        createTimeCohorts.length,

    spawnGroupCount:
        spawnGroups.length,

    spawnGroupSizeDistribution:
        countValues(
            spawnGroups.map(
                group =>
                    group.memberCount
            )
        ),

    respawnDelayCandidates,

    spawnGroups
};


// ============================================================
// WRITE
// ============================================================

writeFileSync(

    instanceOutputPath,

    JSON.stringify(
        instanceOutput,
        null,
        2
    ),

    'utf8'
);


writeFileSync(

    cohortOutputPath,

    JSON.stringify(
        cohortOutput,
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
    '===================================='
);
console.log(
    'NEUTRAL LOGICAL INSTANCE AUDIT'
);
console.log(
    '===================================='
);
console.log('');


console.log(
    `Unique entity indexes: ${instanceOutput.uniqueEntityIndexes}`
);

console.log(
    `Logical instances: ${logicalInstances.length}`
);

console.log(
    `Create-time cohorts: ${createTimeCohorts.length}`
);

console.log(
    `Spatial spawn groups: ${spawnGroups.length}`
);


console.log('');
console.log(
    'Spawn group sizes:'
);

console.log(
    JSON.stringify(
        cohortOutput
            .spawnGroupSizeDistribution
    )
);


console.log('');
console.log(
    'FULL-CLEAR → NEXT SAME-SITE SPAWN CANDIDATES'
);

console.log(
    '---------------------------------------------'
);


for (
    const row
    of respawnDelayCandidates
) {

    console.log(
        `${row.spawnGroupId}` +
        ` size=${row.memberCount}` +
        ` clear=${formatClock(row.clearMatchTimeSeconds)}` +
        ` -> ${row.nextSpawnGroupId}` +
        ` delay=${row.secondsAfterFullClear.toFixed(3)}s` +
        ` dist=${row.centroidDistanceXY.toFixed(1)}`
    );
}


console.log('');
console.log(
    `Instances:\n${instanceOutputPath}`
);

console.log('');

console.log(
    `Spawn cohorts:\n${cohortOutputPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// CREATE-TIME CLUSTERING
// ============================================================

function clusterByCreateTime(
    values,
    tolerance
) {

    const sorted =
        [...values]
            .sort(
                (
                    a,
                    b
                ) =>
                    a.createTime -
                    b.createTime
            );


    const cohorts =
        [];


    for (
        const value
        of sorted
    ) {

        const last =
            cohorts.at(
                -1
            );


        if (
            !last
            ||
            value.createTime -
            last.maxCreateTime
            >
            tolerance
        ) {

            cohorts.push({

                minCreateTime:
                    value.createTime,

                maxCreateTime:
                    value.createTime,

                instances:
                    [value]
            });


            continue;
        }


        last.instances.push(
            value
        );


        last.maxCreateTime =
            Math.max(
                last.maxCreateTime,
                value.createTime
            );
    }


    return cohorts;
}


// ============================================================
// SPATIAL COMPONENTS
// ============================================================

function connectedComponents(
    values,
    xyRadius,
    zRadius
) {

    const remaining =
        new Set(
            values.map(
                (
                    value,
                    index
                ) =>
                    index
            )
        );


    const components =
        [];


    while (
        remaining.size
    ) {

        const firstIndex =
            remaining
                .values()
                .next()
                .value;


        remaining.delete(
            firstIndex
        );


        const queue =
            [firstIndex];


        const component =
            [];


        while (
            queue.length
        ) {

            const currentIndex =
                queue.shift();


            const current =
                values[
                    currentIndex
                ];


            component.push(
                current
            );


            for (
                const otherIndex
                of [...remaining]
            ) {

                const other =
                    values[
                        otherIndex
                    ];


                if (
                    !current
                        .firstObservedPosition
                    ||
                    !other
                        .firstObservedPosition
                ) {

                    continue;
                }


                const xy =
                    distanceXY(

                        current
                            .firstObservedPosition,

                        other
                            .firstObservedPosition
                    );


                const dz =
                    Math.abs(

                        current
                            .firstObservedPosition
                            .z

                        -

                        other
                            .firstObservedPosition
                            .z
                    );


                if (
                    xy <=
                    xyRadius
                    &&
                    dz <=
                    zRadius
                ) {

                    remaining.delete(
                        otherIndex
                    );


                    queue.push(
                        otherIndex
                    );
                }
            }
        }


        components.push(
            component
        );
    }


    return components;
}


// ============================================================
// POSITION
// ============================================================

function worldPosition(
    entity
) {

    const cellX =
        numberField(
            entity,
            'CBodyComponent.m_cellX'
        );

    const cellY =
        numberField(
            entity,
            'CBodyComponent.m_cellY'
        );

    const cellZ =
        numberField(
            entity,
            'CBodyComponent.m_cellZ'
        );

    const vecX =
        numberField(
            entity,
            'CBodyComponent.m_vecX'
        );

    const vecY =
        numberField(
            entity,
            'CBodyComponent.m_vecY'
        );

    const vecZ =
        numberField(
            entity,
            'CBodyComponent.m_vecZ'
        );


    if (
        ![
            cellX,
            cellY,
            cellZ,
            vecX,
            vecY,
            vecZ
        ]
        .every(
            Number.isFinite
        )
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
            cellZ *
            512
            -
            16384
            +
            vecZ
    };
}


// ============================================================
// CENTROID
// ============================================================

function centroid(
    members
) {

    const positions =
        members

            .map(
                member =>
                    member
                        .firstObservedPosition
            )

            .filter(
                Boolean
            );


    if (
        !positions.length
    ) {

        return {

            x:
                null,

            y:
                null,

            z:
                null
        };
    }


    return {

        x:
            average(
                positions.map(
                    position =>
                        position.x
                )
            ),

        y:
            average(
                positions.map(
                    position =>
                        position.y
                )
            ),

        z:
            average(
                positions.map(
                    position =>
                        position.z
                )
            )
    };
}


// ============================================================
// DISTANCE
// ============================================================

function distanceXY(
    a,
    b
) {

    if (
        !a
        ||
        !b
        ||
        !Number.isFinite(
            a.x
        )
        ||
        !Number.isFinite(
            a.y
        )
        ||
        !Number.isFinite(
            b.x
        )
        ||
        !Number.isFinite(
            b.y
        )
    ) {

        return Infinity;
    }


    return Math.hypot(

        a.x -
        b.x,

        a.y -
        b.y
    );
}


// ============================================================
// UNIT TYPE
// ============================================================

function classifySubclass(
    subclass
) {

    const value =
        String(
            subclass
        );


    if (
        value ===
        '1250952856'
    ) {

        return 'SMALL_UNIT';
    }


    if (
        value ===
        '941701082'
    ) {

        return 'MEDIUM_UNIT';
    }


    if (
        value ===
        '3392417854'
    ) {

        return 'LARGE_UNIT';
    }


    return 'UNKNOWN_UNIT';
}


// ============================================================
// FIELD
// ============================================================

function numberField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    const number =
        Number(
            entity.getField(
                field
            )
        );


    return Number.isFinite(
        number
    )
        ? number
        : null;
}


// ============================================================
// MATH
// ============================================================

function average(
    values
) {

    if (
        !values.length
    ) {

        return null;
    }


    return values.reduce(
        (
            total,
            value
        ) =>
            total +
            value,
        0
    )
    /
    values.length;
}


function summarize(
    values
) {

    const sorted =
        [...values]

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
        !sorted.length
    ) {

        return {
            count: 0
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
            sorted.at(-1)
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


function countValues(
    values
) {

    const output =
        {};


    for (
        const value
        of values
    ) {

        const key =
            String(
                value
            );


        output[key] =
            (
                output[key]
                ??
                0
            )
            +
            1;
    }


    return output;
}


// ============================================================
// TIME
// ============================================================

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