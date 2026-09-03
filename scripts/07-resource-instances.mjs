import {
    createReadStream,
    writeFileSync
} from 'node:fs';

import readline from 'node:readline';


// ============================================================
// FILES
// ============================================================

const inputPath =
    '.\\output\\test\\resource_lifecycles.jsonl';

const outputPath =
    '.\\output\\test\\resource_instance_summary.json';


// ============================================================
// STORAGE
// ============================================================

const classes =
    new Map();


// ============================================================
// READ EXISTING LIFECYCLE FILE
// ============================================================

const rl =
    readline.createInterface({

        input:
            createReadStream(
                inputPath
            ),

        crlfDelay:
            Infinity
    });


for await (const line of rl) {

    if (!line.trim()) {
        continue;
    }

    const record =
        JSON.parse(line);

    const className =
        record.className;

    if (!classes.has(className)) {

        classes.set(
            className,
            {
                rawCreates: 0,
                rawUpdates: 0,
                rawDeletes: 0,
                rawLeaves: 0,

                missingCreateTime: 0,

                instances:
                    new Map()
            }
        );
    }

    const stats =
        classes.get(className);


    // ========================================================
    // CREATE
    // ========================================================

    if (
        record.event ===
        'CREATE'
    ) {

        stats.rawCreates++;


        const createTime =
            record.fields?.m_flCreateTime;


        if (
            !Number.isFinite(
                createTime
            )
        ) {

            stats.missingCreateTime++;
        }


        // ----------------------------------------------------
        // Logical instance ID
        //
        // Prefer entityIndex + actual entity creation time.
        //
        // The fallback deliberately treats the observation
        // as unique because we cannot safely merge it.
        // ----------------------------------------------------

        const instanceKey =
            Number.isFinite(createTime)

                ? `${record.entityIndex}|${createTime}`

                : `${record.entityIndex}|missing|${record.tick}`;


        if (
            !stats.instances.has(
                instanceKey
            )
        ) {

            stats.instances.set(
                instanceKey,
                {

                    key:
                        instanceKey,

                    entityIndex:
                        record.entityIndex,

                    createTime,

                    firstObservedTick:
                        record.tick,

                    firstObservedMatchTime:
                        record.matchTimeSeconds,

                    firstObservedClock:
                        record.matchClock,

                    lastObservedCreateTick:
                        record.tick,

                    lastObservedCreateMatchTime:
                        record.matchTimeSeconds,

                    repeatedCreateCount:
                        0,

                    position:
                        record.position ?? null,

                    initialFields:
                        record.fields ?? {}
                }
            );

        } else {

            const instance =
                stats.instances.get(
                    instanceKey
                );

            instance.repeatedCreateCount++;

            instance.lastObservedCreateTick =
                record.tick;

            instance.lastObservedCreateMatchTime =
                record.matchTimeSeconds;
        }

        continue;
    }


    // ========================================================
    // OTHER OPERATIONS
    // ========================================================

    if (
        record.event ===
        'UPDATE'
    ) {

        stats.rawUpdates++;
        continue;
    }


    if (
        record.event ===
        'DELETE'
    ) {

        stats.rawDeletes++;
        continue;
    }


    if (
        record.event ===
        'LEAVE'
    ) {

        stats.rawLeaves++;
    }
}


// ============================================================
// BUILD SUMMARY
// ============================================================

const classResults = [];


for (
    const [className, stats]
    of classes.entries()
) {

    const instances =
        [...stats.instances.values()]
            .sort(
                (a, b) =>
                    (
                        a.firstObservedMatchTime ??
                        Infinity
                    )
                    -
                    (
                        b.firstObservedMatchTime ??
                        Infinity
                    )
            );


    const entityIndexes =
        new Set(
            instances.map(
                item =>
                    item.entityIndex
            )
        );


    let repeatedCreateEvents =
        0;


    for (
        const instance
        of instances
    ) {

        repeatedCreateEvents +=
            instance.repeatedCreateCount;
    }


    // ========================================================
    // POSITION CLUSTERS
    //
    // Group FIRST observed positions into 128-unit buckets.
    // This is only exploratory.
    // ========================================================

    const clusterMap =
        new Map();


    for (
        const instance
        of instances
    ) {

        const x =
            instance.position
                ?.world
                ?.x;

        const y =
            instance.position
                ?.world
                ?.y;


        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            continue;
        }


        const bucketX =
            Math.round(
                x / 128
            ) * 128;

        const bucketY =
            Math.round(
                y / 128
            ) * 128;


        const key =
            `${bucketX},${bucketY}`;


        if (
            !clusterMap.has(key)
        ) {

            clusterMap.set(
                key,
                {
                    x:
                        bucketX,

                    y:
                        bucketY,

                    count:
                        0
                }
            );
        }


        clusterMap.get(
            key
        ).count++;
    }


    const positionClusters =
        [...clusterMap.values()]
            .sort(
                (a, b) =>
                    b.count -
                    a.count
            );


    // ========================================================
    // REPEATED CREATE DISTRIBUTION
    // ========================================================

    const mostRepeated =
        [...instances]
            .sort(
                (a, b) =>
                    b.repeatedCreateCount -
                    a.repeatedCreateCount
            )
            .slice(
                0,
                10
            );


    // ========================================================
    // RESULT
    // ========================================================

    classResults.push({

        className,

        networkEvents: {

            rawCreates:
                stats.rawCreates,

            rawUpdates:
                stats.rawUpdates,

            rawDeletes:
                stats.rawDeletes,

            rawLeaves:
                stats.rawLeaves
        },

        logicalInstances: {

            count:
                instances.length,

            uniqueEntityIndexes:
                entityIndexes.size,

            repeatedCreateEvents,

            missingCreateTime:
                stats.missingCreateTime,

            firstObservedMatchTime:
                instances[0]
                    ?.firstObservedMatchTime
                    ?? null,

            firstObservedClock:
                instances[0]
                    ?.firstObservedClock
                    ?? null,

            lastObservedMatchTime:
                instances.at(-1)
                    ?.firstObservedMatchTime
                    ?? null,

            lastObservedClock:
                instances.at(-1)
                    ?.firstObservedClock
                    ?? null
        },

        topPositionClusters:
            positionClusters.slice(
                0,
                20
            ),

        mostRepeatedInstances:
            mostRepeated.map(
                item => ({

                    entityIndex:
                        item.entityIndex,

                    createTime:
                        item.createTime,

                    firstObservedClock:
                        item.firstObservedClock,

                    lastObservedCreateMatchTime:
                        item.lastObservedCreateMatchTime,

                    repeatedCreateCount:
                        item.repeatedCreateCount,

                    position:
                        item.position?.world
                        ?? null
                })
            ),

        sampleInstances:
            instances
                .slice(
                    0,
                    25
                )
                .map(
                    item => ({

                        entityIndex:
                            item.entityIndex,

                        createTime:
                            item.createTime,

                        firstObservedMatchTime:
                            item.firstObservedMatchTime,

                        firstObservedClock:
                            item.firstObservedClock,

                        repeatedCreateCount:
                            item.repeatedCreateCount,

                        position:
                            item.position?.world
                            ?? null,

                        initialFields:
                            item.initialFields
                    })
                )
    });
}


// Sort largest logical populations first.

classResults.sort(
    (a, b) =>
        b.logicalInstances.count -
        a.logicalInstances.count
);


// ============================================================
// WRITE
// ============================================================

const result = {

    method:
        'logical instance = className + entityIndex + m_flCreateTime',

    warning:
        'CREATE/LEAVE are network lifecycle events and are not yet interpreted as physical spawn/despawn.',

    classes:
        classResults
};


writeFileSync(

    outputPath,

    JSON.stringify(
        result,
        null,
        2
    ),

    'utf8'
);


console.log('');
console.log('====================================');
console.log('RESOURCE INSTANCE SUMMARY');
console.log('====================================');
console.log('');


for (
    const item
    of classResults
) {

    console.log(
        item.className
    );

    console.log(
        `  raw CREATEs: ${item.networkEvents.rawCreates}`
    );

    console.log(
        `  logical instances: ${item.logicalInstances.count}`
    );

    console.log(
        `  repeated CREATEs: ${item.logicalInstances.repeatedCreateEvents}`
    );

    console.log(
        `  missing createTime: ${item.logicalInstances.missingCreateTime}`
    );

    console.log('');
}


console.log(
    `Output:\n${outputPath}`
);