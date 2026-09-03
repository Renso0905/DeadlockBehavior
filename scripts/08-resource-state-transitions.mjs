import {
    createReadStream,
    createWriteStream,
    writeFileSync
} from 'node:fs';

import readline from 'node:readline';


// ============================================================
// FILES
// ============================================================

const inputPath =
    '.\\output\\test\\resource_lifecycles.jsonl';

const fullOutputPath =
    '.\\output\\test\\resource_state_transitions.jsonl';

const summaryPath =
    '.\\output\\test\\resource_state_transition_summary.json';


// ============================================================
// CLASSES WE ACTUALLY WANT TO TEST
// ============================================================

const TARGET_CLASSES = new Set([

    'CNPC_TrooperNeutral',

    'CNPC_Neutral_SinnersSacrifice',

    'CNPC_MidBoss'
]);


// ============================================================
// TRACKING
// ============================================================

const instances = new Map();

const currentInstanceByEntity =
    new Map();

const classStats =
    new Map();

const output =
    createWriteStream(
        fullOutputPath,
        { encoding: 'utf8' }
    );


// ============================================================
// READ LIFECYCLE FILE
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

    if (
        !TARGET_CLASSES.has(
            record.className
        )
    ) {
        continue;
    }


    const entityKey =
        `${record.className}|${record.entityIndex}`;


    // ========================================================
    // CREATE
    // ========================================================

    if (
        record.event === 'CREATE'
    ) {

        const payload =
            record.fields ?? {};

        const createTime =
            payload.m_flCreateTime;


        const logicalKey =
            Number.isFinite(
                createTime
            )
                ? `${entityKey}|${createTime}`
                : `${entityKey}|unknown`;


        let instance =
            instances.get(
                logicalKey
            );


        if (!instance) {

            instance = {

                key:
                    logicalKey,

                className:
                    record.className,

                entityIndex:
                    record.entityIndex,

                createTime,

                subclassId:
                    payload.m_nSubclassID
                    ?? null,

                firstSeenTime:
                    record.matchTimeSeconds,

                firstSeenClock:
                    record.matchClock,

                position:
                    record.position
                        ?.world
                        ?? null,

                state: {
                    health: null,
                    maxHealth: null,
                    lifeState: null,
                    npcState: null,
                    vaultState: null
                },

                networkCreates: 0,

                downEvents: [],
                upEvents: [],

                lastDownTime: null
            };


            instances.set(
                logicalKey,
                instance
            );
        }


        instance.networkCreates++;


        currentInstanceByEntity.set(
            entityKey,
            instance
        );


        applyPayload(
            instance,
            payload,
            record,
            'CREATE'
        );

        continue;
    }


    // ========================================================
    // FIND CURRENT INSTANCE FOR UPDATE/DELETE
    // ========================================================

    const instance =
        currentInstanceByEntity.get(
            entityKey
        );


    if (!instance) {
        continue;
    }


    // ========================================================
    // UPDATE
    // ========================================================

    if (
        record.event === 'UPDATE'
    ) {

        applyPayload(
            instance,
            record.changes ?? {},
            record,
            'UPDATE'
        );

        continue;
    }


    // ========================================================
    // DELETE
    // ========================================================

    if (
        record.event === 'DELETE'
    ) {

        const wasAlive =
            deriveAlive(
                instance.state
            );


        if (
            wasAlive === true
        ) {

            recordDown(
                instance,
                record,
                'DELETE'
            );
        }


        currentInstanceByEntity.delete(
            entityKey
        );
    }
}


// ============================================================
// BUILD SUMMARY
// ============================================================

for (
    const instance
    of instances.values()
) {

    if (
        !classStats.has(
            instance.className
        )
    ) {

        classStats.set(
            instance.className,
            {
                instances: 0,
                downEvents: 0,
                upEvents: 0,
                subclasses: new Map(),
                transitions: []
            }
        );
    }


    const stats =
        classStats.get(
            instance.className
        );


    stats.instances++;

    stats.downEvents +=
        instance.downEvents.length;

    stats.upEvents +=
        instance.upEvents.length;


    const subclass =
        String(
            instance.subclassId
            ?? 'unknown'
        );


    if (
        !stats.subclasses.has(
            subclass
        )
    ) {

        stats.subclasses.set(
            subclass,
            {
                subclassId:
                    instance.subclassId,

                instances:
                    0,

                firstSeenTime:
                    null,

                firstSeenClock:
                    null,

                initialHealthValues:
                    new Set(),

                downEvents:
                    0,

                upEvents:
                    0
            }
        );
    }


    const sub =
        stats.subclasses.get(
            subclass
        );


    sub.instances++;

    sub.downEvents +=
        instance.downEvents.length;

    sub.upEvents +=
        instance.upEvents.length;


    if (
        sub.firstSeenTime === null
        ||
        instance.firstSeenTime <
        sub.firstSeenTime
    ) {

        sub.firstSeenTime =
            instance.firstSeenTime;

        sub.firstSeenClock =
            instance.firstSeenClock;
    }


    for (
        const event
        of [
            ...instance.downEvents,
            ...instance.upEvents
        ]
    ) {

        stats.transitions.push(
            event
        );
    }
}


// ============================================================
// FORMAT RESULTS
// ============================================================

const results = [];


for (
    const [className, stats]
    of classStats.entries()
) {

    const subclasses =
        [...stats.subclasses.values()]
            .map(
                item => ({

                    subclassId:
                        item.subclassId,

                    instances:
                        item.instances,

                    firstSeenTime:
                        item.firstSeenTime,

                    firstSeenClock:
                        item.firstSeenClock,

                    downEvents:
                        item.downEvents,

                    upEvents:
                        item.upEvents
                })
            )
            .sort(
                (a, b) =>
                    (
                        a.firstSeenTime
                        ?? Infinity
                    )
                    -
                    (
                        b.firstSeenTime
                        ?? Infinity
                    )
            );


    stats.transitions.sort(
        (a, b) =>
            a.matchTimeSeconds -
            b.matchTimeSeconds
    );


    results.push({

        className,

        logicalInstances:
            stats.instances,

        downEvents:
            stats.downEvents,

        upEvents:
            stats.upEvents,

        subclasses,

        sampleTransitions:
            stats.transitions.slice(
                0,
                100
            )
    });
}


// ============================================================
// OUTPUT SUMMARY
// ============================================================

const summary = {

    definition: {

        down:
            'derived alive state changed true -> false, or live entity was deleted',

        up:
            'derived alive state changed false -> true',

        aliveLogic:
            'health > 0 when health is known; otherwise lifeState === 0'
    },

    classes:
        results
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


output.end();


console.log('');
console.log('====================================');
console.log('RESOURCE STATE TRANSITIONS');
console.log('====================================');
console.log('');


for (
    const result
    of results
) {

    console.log(
        result.className
    );

    console.log(
        `  logical instances: ${result.logicalInstances}`
    );

    console.log(
        `  DOWN events: ${result.downEvents}`
    );

    console.log(
        `  UP events: ${result.upEvents}`
    );

    console.log('');

    for (
        const subclass
        of result.subclasses
    ) {

        console.log(
            `    subclass ${subclass.subclassId}`
        );

        console.log(
            `      instances=${subclass.instances}`
        );

        console.log(
            `      first=${subclass.firstSeenClock}`
        );

        console.log(
            `      down=${subclass.downEvents}`
        );

        console.log(
            `      up=${subclass.upEvents}`
        );
    }

    console.log('');
}


console.log(
    `Summary:\n${summaryPath}`
);

console.log('');

console.log(
    `Full transitions:\n${fullOutputPath}`
);


// ============================================================
// STATE APPLICATION
// ============================================================

function applyPayload(
    instance,
    payload,
    record,
    source
) {

    const oldAlive =
        deriveAlive(
            instance.state
        );


    if (
        payload.m_iHealth !== undefined
    ) {

        instance.state.health =
            payload.m_iHealth;
    }


    if (
        payload.m_iMaxHealth !== undefined
    ) {

        instance.state.maxHealth =
            payload.m_iMaxHealth;
    }


    if (
        payload.m_lifeState !== undefined
    ) {

        instance.state.lifeState =
            payload.m_lifeState;
    }


    if (
        payload.m_NPCState !== undefined
    ) {

        instance.state.npcState =
            payload.m_NPCState;
    }


    if (
        payload.m_iVaultState !== undefined
    ) {

        instance.state.vaultState =
            payload.m_iVaultState;
    }


    const newAlive =
        deriveAlive(
            instance.state
        );


    if (
        oldAlive === true &&
        newAlive === false
    ) {

        recordDown(
            instance,
            record,
            source
        );
    }


    if (
        oldAlive === false &&
        newAlive === true
    ) {

        recordUp(
            instance,
            record,
            source
        );
    }
}


// ============================================================
// DERIVED ALIVE STATE
// ============================================================

function deriveAlive(state) {

    if (
        Number.isFinite(
            state.health
        )
    ) {

        return (
            state.health > 0
        );
    }


    if (
        Number.isFinite(
            state.lifeState
        )
    ) {

        return (
            state.lifeState === 0
        );
    }


    return null;
}


// ============================================================
// DOWN / UP EVENTS
// ============================================================

function recordDown(
    instance,
    record,
    source
) {

    // Prevent duplicate DOWN events
    // within the same quarter-second window.

    const previous =
        instance.downEvents.at(-1);


    if (
        previous &&
        Math.abs(
            previous.matchTimeSeconds -
            record.matchTimeSeconds
        ) < 0.25
    ) {
        return;
    }


    const event = {

        transition:
            'DOWN',

        className:
            instance.className,

        entityIndex:
            instance.entityIndex,

        subclassId:
            instance.subclassId,

        matchTimeSeconds:
            record.matchTimeSeconds,

        matchClock:
            record.matchClock,

        source,

        health:
            instance.state.health,

        maxHealth:
            instance.state.maxHealth,

        lifeState:
            instance.state.lifeState,

        npcState:
            instance.state.npcState,

        vaultState:
            instance.state.vaultState,

        position:
            instance.position
    };


    instance.downEvents.push(
        event
    );

    instance.lastDownTime =
        record.matchTimeSeconds;


    output.write(
        JSON.stringify(event) +
        '\n'
    );
}


function recordUp(
    instance,
    record,
    source
) {

    const previous =
        instance.upEvents.at(-1);


    if (
        previous &&
        Math.abs(
            previous.matchTimeSeconds -
            record.matchTimeSeconds
        ) < 0.25
    ) {
        return;
    }


    const downtime =
        Number.isFinite(
            instance.lastDownTime
        )
            ? record.matchTimeSeconds -
              instance.lastDownTime
            : null;


    const event = {

        transition:
            'UP',

        className:
            instance.className,

        entityIndex:
            instance.entityIndex,

        subclassId:
            instance.subclassId,

        matchTimeSeconds:
            record.matchTimeSeconds,

        matchClock:
            record.matchClock,

        source,

        downtimeSeconds:
            downtime,

        health:
            instance.state.health,

        maxHealth:
            instance.state.maxHealth,

        lifeState:
            instance.state.lifeState,

        npcState:
            instance.state.npcState,

        vaultState:
            instance.state.vaultState,

        position:
            instance.position
    };


    instance.upEvents.push(
        event
    );


    output.write(
        JSON.stringify(event) +
        '\n'
    );
}