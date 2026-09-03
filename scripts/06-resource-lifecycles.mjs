import {
    createReadStream,
    createWriteStream,
    mkdirSync,
    writeFileSync
} from 'node:fs';

import {
    basename,
    extname,
    join,
    resolve
} from 'node:path';

import {
    EntityOperation,
    InterceptorStage,
    Logger,
    Parser,
    ParserConfiguration
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const TICKS_PER_SECOND = 64;

const CELL_SIZE = 512;
const WORLD_OFFSET = 16384;


// These are CANDIDATE resource / objective classes.
//
// We are deliberately NOT assigning final semantic labels yet.
const TARGET_CLASSES = [

    // Neutral camps
    'CNPC_TrooperNeutral',
    'CNPC_Neutral_Bug',
    'CNPC_Neutral_SinnersSacrifice',
    'CNPC_Boss_Tier2',
    'CNPC_Boss_Tier3',

    // Mid Boss
    'CNPC_MidBoss',

    // Breakable / pickup candidates
    'CCitadelItemPunchableNeutralGold',
    'CCitadelItemPickupIdol',
    'CCitadel_Pickup_AssignedGold'
];

const TARGET_CLASS_SET =
    new Set(TARGET_CLASSES);


// ============================================================
// INPUT
// ============================================================

const replayPath = process.argv[2];

if (!replayPath) {
    console.error(
        'Usage: node scripts/06-resource-lifecycles.mjs replays/test.dem'
    );

    process.exit(1);
}

const absolutePath =
    resolve(replayPath);

const replayName =
    basename(
        absolutePath,
        extname(absolutePath)
    );

const outputDir =
    resolve(
        'output',
        replayName
    );

mkdirSync(
    outputDir,
    { recursive: true }
);


// ============================================================
// OUTPUT
// ============================================================

const eventPath =
    join(
        outputDir,
        'resource_lifecycles.jsonl'
    );

const summaryPath =
    join(
        outputDir,
        'resource_lifecycle_summary.json'
    );

const output =
    createWriteStream(
        eventPath,
        { encoding: 'utf8' }
    );


// ============================================================
// PARSER
// ============================================================

const config =
    new ParserConfiguration({
        entityClasses: [
            'CCitadelGameRulesProxy',
            ...TARGET_CLASSES
        ]
    });

const parser =
    new Parser(
        config,
        Logger.CONSOLE_INFO
    );


// ============================================================
// TRACKING
// ============================================================

let matchClockOffsetSeconds = null;

let totalRecords = 0;

const counts =
    new Map();

const firstSpawnByClass =
    new Map();

const lastSpawnByClass =
    new Map();


// ============================================================
// ENTITY EVENTS
// ============================================================

parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,

    (
        demoPacket,
        messagePacket,
        events
    ) => {

        updateClockOffset();

        const tick =
            demoPacket.tick;

        const demoSeconds =
            tick / TICKS_PER_SECOND;

        const matchTimeSeconds =
            Number.isFinite(
                matchClockOffsetSeconds
            )
                ? demoSeconds -
                  matchClockOffsetSeconds
                : null;


        for (const event of events) {

            const entity =
                event.entity;

            if (!entity) {
                continue;
            }

            const className =
                entity.class?.name;

            if (
                !TARGET_CLASS_SET.has(
                    className
                )
            ) {
                continue;
            }


            const operation =
                operationName(
                    event.operation
                );


            // ---------------------------------------------
            // CREATE
            // ---------------------------------------------

            if (
                event.operation ===
                EntityOperation.CREATE
            ) {

                const changes =
                    event.getChanges();

                const record = {

                    event:
                        'CREATE',

                    className,

                    entityIndex:
                        entity.index,

                    tick,

                    demoSeconds,

                    matchTimeSeconds,

                    matchClock:
                        formatMatchClock(
                            matchTimeSeconds
                        ),

                    position:
                        getPosition(
                            entity
                        ),

                    fields:
                        cleanInterestingFields(
                            changes
                        )
                };


                writeRecord(record);

                incrementCount(
                    className,
                    'CREATE'
                );


                if (
                    !firstSpawnByClass.has(
                        className
                    )
                ) {

                    firstSpawnByClass.set(
                        className,
                        matchTimeSeconds
                    );
                }


                lastSpawnByClass.set(
                    className,
                    matchTimeSeconds
                );

                continue;
            }


            // ---------------------------------------------
            // UPDATE
            // ---------------------------------------------

            if (
                event.operation ===
                EntityOperation.UPDATE
            ) {

                const changes =
                    event.getChanges();

                const interesting =
                    cleanInterestingFields(
                        changes
                    );


                // Ignore movement/animation-only updates.
                if (
                    Object.keys(
                        interesting
                    ).length === 0
                ) {
                    continue;
                }


                const record = {

                    event:
                        'UPDATE',

                    className,

                    entityIndex:
                        entity.index,

                    tick,

                    demoSeconds,

                    matchTimeSeconds,

                    matchClock:
                        formatMatchClock(
                            matchTimeSeconds
                        ),

                    position:
                        getPosition(
                            entity
                        ),

                    changes:
                        interesting
                };


                writeRecord(record);

                incrementCount(
                    className,
                    'UPDATE'
                );

                continue;
            }


            // ---------------------------------------------
            // DELETE / LEAVE
            // ---------------------------------------------

            if (
                event.operation ===
                    EntityOperation.DELETE
                ||
                event.operation ===
                    EntityOperation.LEAVE
            ) {

                const record = {

                    event:
                        operation,

                    className,

                    entityIndex:
                        entity.index,

                    tick,

                    demoSeconds,

                    matchTimeSeconds,

                    matchClock:
                        formatMatchClock(
                            matchTimeSeconds
                        ),

                    // Important:
                    // this gives us the object's last known
                    // position before disappearing.
                    position:
                        getPosition(
                            entity
                        ),

                    finalState:
                        getSelectedState(
                            entity
                        )
                };


                writeRecord(record);

                incrementCount(
                    className,
                    operation
                );
            }
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');
console.log('====================================');
console.log('Resource Lifecycle Discovery');
console.log('====================================');

console.log(
    `Replay: ${absolutePath}`
);

console.log('');

console.log(
    'Watching candidate resource classes:'
);

for (
    const className
    of TARGET_CLASSES
) {

    console.log(
        `  ${className}`
    );
}

console.log('');


try {

    await parser.parse(
        createReadStream(
            absolutePath
        )
    );


    const classSummary =
        TARGET_CLASSES.map(
            className => {

                const classCounts =
                    counts.get(
                        className
                    ) ?? {};

                return {

                    className,

                    create:
                        classCounts.CREATE ?? 0,

                    update:
                        classCounts.UPDATE ?? 0,

                    delete:
                        classCounts.DELETE ?? 0,

                    leave:
                        classCounts.LEAVE ?? 0,

                    firstCreateMatchTime:
                        firstSpawnByClass.get(
                            className
                        ) ?? null,

                    firstCreateClock:
                        formatMatchClock(
                            firstSpawnByClass.get(
                                className
                            )
                        ),

                    lastCreateMatchTime:
                        lastSpawnByClass.get(
                            className
                        ) ?? null,

                    lastCreateClock:
                        formatMatchClock(
                            lastSpawnByClass.get(
                                className
                            )
                        )
                };
            }
        );


    const summary = {

        replay:
            replayName,

        matchClockOffsetSeconds,

        totalLifecycleRecords:
            totalRecords,

        coordinateFormula:
            'world = cell * 512 - 16384 + vec',

        classes:
            classSummary
    };


    writeFileSync(
        summaryPath,

        JSON.stringify(
            summary,
            null,
            2
        ),

        'utf8'
    );


    console.log('');
    console.log('====================================');
    console.log('DISCOVERY COMPLETE');
    console.log('====================================');

    console.log(
        `Lifecycle records: ${totalRecords}`
    );

    console.log('');

    for (
        const item
        of classSummary
    ) {

        console.log(
            `${item.className}`
        );

        console.log(
            `  creates=${item.create}`
        );

        console.log(
            `  deletes=${item.delete}`
        );

        console.log(
            `  leaves=${item.leave}`
        );

        console.log(
            `  first=${item.firstCreateClock}`
        );

        console.log(
            `  last=${item.lastCreateClock}`
        );
    }


    console.log('');

    console.log(
        `Events:\n${eventPath}`
    );

    console.log('');

    console.log(
        `Summary:\n${summaryPath}`
    );


} catch (error) {

    console.error('');
    console.error('RESOURCE DISCOVERY FAILED');
    console.error(error);

    process.exitCode = 1;

} finally {

    await parser.dispose();

    await new Promise(
        resolvePromise => {

            output.end(
                resolvePromise
            );
        }
    );
}


// ============================================================
// CLOCK
// ============================================================

function updateClockOffset() {

    if (
        Number.isFinite(
            matchClockOffsetSeconds
        )
    ) {
        return;
    }

    const demo =
        parser.getDemo();

    const rules =
        demo.getEntitiesByClassName(
            'CCitadelGameRulesProxy'
        )[0];

    if (!rules) {
        return;
    }

    const gameStart =
        rules.getField(
            'm_pGameRules.m_flGameStartTime'
        );

    const stateStart =
        rules.getField(
            'm_pGameRules.m_flGameStateStartTime'
        );


    if (
        Number.isFinite(gameStart)
        &&
        Number.isFinite(stateStart)
    ) {

        matchClockOffsetSeconds =
            gameStart -
            stateStart;
    }
}


// ============================================================
// POSITION
// ============================================================

function getPosition(entity) {

    const cellX =
        entity.getField(
            'CBodyComponent.m_cellX'
        );

    const cellY =
        entity.getField(
            'CBodyComponent.m_cellY'
        );

    const cellZ =
        entity.getField(
            'CBodyComponent.m_cellZ'
        );

    const vecX =
        entity.getField(
            'CBodyComponent.m_vecX'
        );

    const vecY =
        entity.getField(
            'CBodyComponent.m_vecY'
        );

    const vecZ =
        entity.getField(
            'CBodyComponent.m_vecZ'
        );


    return {

        raw: {
            cellX,
            cellY,
            cellZ,
            vecX,
            vecY,
            vecZ
        },

        world: {

            x:
                decodeCoordinate(
                    cellX,
                    vecX
                ),

            y:
                decodeCoordinate(
                    cellY,
                    vecY
                ),

            z:
                decodeCoordinate(
                    cellZ,
                    vecZ
                )
        }
    };
}


function decodeCoordinate(
    cell,
    local
) {

    if (
        !Number.isFinite(cell)
        ||
        !Number.isFinite(local)
    ) {
        return null;
    }

    return (
        cell *
        CELL_SIZE
        -
        WORLD_OFFSET
        +
        local
    );
}


// ============================================================
// STATE
// ============================================================

function getSelectedState(entity) {

    const fields = [

        'm_iHealth',
        'm_iMaxHealth',
        'm_lifeState',

        'm_NPCState',

        'm_iTeamNum',
        'm_iLane',

        'm_hOwnerEntity',

        'm_flCreateTime',

        'm_nSubclassID'
    ];

    const result = {};


    for (
        const field
        of fields
    ) {

        const value =
            entity.getField(
                field
            );

        if (
            value !== undefined
        ) {

            result[field] =
                safeValue(
                    value
                );
        }
    }


    return result;
}


// ============================================================
// FIELD FILTERING
// ============================================================

function cleanInterestingFields(
    changes
) {

    const result = {};


    for (
        const [name, value]
        of Object.entries(
            changes ?? {}
        )
    ) {

        if (
            shouldKeepField(
                name
            )
        ) {

            result[name] =
                safeValue(
                    value
                );
        }
    }


    return result;
}


function shouldKeepField(name) {

    // -----------------------------------------
    // Explicitly drop high-frequency noise
    // -----------------------------------------

    if (
        name ===
        'm_flSimulationTime'
    ) {
        return false;
    }

    if (
        name.includes(
            'serializedPoseRecipe'
        )
    ) {
        return false;
    }

    if (
        name.includes(
            'ModifierProp'
        )
    ) {
        return false;
    }

    if (
        name.startsWith(
            'CBodyComponent.m_vec'
        )
    ) {
        return false;
    }

    if (
        name.startsWith(
            'CBodyComponent.m_ang'
        )
    ) {
        return false;
    }


    // -----------------------------------------
    // Keep fields that may tell us what the
    // resource is or whether it is available.
    // -----------------------------------------

    return (
        /health/i.test(name)
        ||
        /life/i.test(name)
        ||
        /state/i.test(name)
        ||
        /spawn/i.test(name)
        ||
        /respawn/i.test(name)
        ||
        /create/i.test(name)
        ||
        /cooldown/i.test(name)
        ||
        /available/i.test(name)
        ||
        /active/i.test(name)
        ||
        /owner/i.test(name)
        ||
        /team/i.test(name)
        ||
        /lane/i.test(name)
        ||
        /gold/i.test(name)
        ||
        /soul/i.test(name)
        ||
        /currency/i.test(name)
        ||
        /value/i.test(name)
        ||
        /pickup/i.test(name)
        ||
        /subclass/i.test(name)
        ||
        /type/i.test(name)
        ||
        /tier/i.test(name)
    );
}


// ============================================================
// OUTPUT HELPERS
// ============================================================

function writeRecord(record) {

    output.write(
        JSON.stringify(
            safeValue(record)
        ) +
        '\n'
    );

    totalRecords++;
}


function incrementCount(
    className,
    operation
) {

    if (
        !counts.has(
            className
        )
    ) {

        counts.set(
            className,
            {}
        );
    }

    const item =
        counts.get(
            className
        );

    item[operation] =
        (item[operation] ?? 0) + 1;
}


function operationName(
    operation
) {

    if (
        operation ===
        EntityOperation.CREATE
    ) {
        return 'CREATE';
    }

    if (
        operation ===
        EntityOperation.UPDATE
    ) {
        return 'UPDATE';
    }

    if (
        operation ===
        EntityOperation.DELETE
    ) {
        return 'DELETE';
    }

    if (
        operation ===
        EntityOperation.LEAVE
    ) {
        return 'LEAVE';
    }

    return String(operation);
}


function formatMatchClock(
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
        seconds < 0;

    const absolute =
        Math.abs(seconds);

    const minutes =
        Math.floor(
            absolute / 60
        );

    const secs =
        Math.floor(
            absolute % 60
        );

    const formatted =
        `${minutes}:${String(secs).padStart(2, '0')}`;

    return negative
        ? `-${formatted}`
        : formatted;
}


function safeValue(value) {

    if (
        value === null
        ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value === 'bigint'
    ) {
        return value.toString();
    }

    if (
        Array.isArray(value)
    ) {

        return value.map(
            safeValue
        );
    }

    if (
        typeof value === 'object'
    ) {

        const result = {};

        for (
            const [key, child]
            of Object.entries(value)
        ) {

            result[key] =
                safeValue(
                    child
                );
        }

        return result;
    }

    return value;
}