import {
    createReadStream,
    readFileSync,
    writeFileSync,
    mkdirSync
} from 'node:fs';

import readline from 'node:readline';
import { resolve } from 'node:path';


// ============================================================
// PATHS
// ============================================================

const replayName =
    process.argv[2] ?? 'test';

const outputDir =
    resolve('output', replayName);

const inspectorDir =
    resolve('inspector', 'data');

mkdirSync(
    inspectorDir,
    { recursive: true }
);

const playerStatePath =
    resolve(
        outputDir,
        'player_state.jsonl'
    );

const playerSummaryPath =
    resolve(
        outputDir,
        'player_state_summary.json'
    );

const resourceLifecyclePath =
    resolve(
        outputDir,
        'resource_lifecycles.jsonl'
    );

const resourceTransitionPath =
    resolve(
        outputDir,
        'resource_state_transitions.jsonl'
    );

const destination =
    resolve(
        inspectorDir,
        `${replayName}.json`
    );


// ============================================================
// LOAD SUMMARY
// ============================================================

const playerSummary =
    JSON.parse(
        readFileSync(
            playerSummaryPath,
            'utf8'
        )
    );


// ============================================================
// PLAYER FRAMES
//
// Keep one frame per second for the visual inspector.
// Original 0.25-second data remains untouched.
// ============================================================

console.log('');
console.log('Reading player states...');

const frameMap =
    new Map();

const playerNames =
    new Set();


const playerReader =
    readline.createInterface({

        input:
            createReadStream(
                playerStatePath
            ),

        crlfDelay:
            Infinity
    });


for await (
    const line
    of playerReader
) {

    if (!line.trim()) {
        continue;
    }

    const row =
        JSON.parse(line);

    const t =
        row.matchTimeSeconds;

    if (
        !Number.isFinite(t)
        ||
        t < 0
    ) {
        continue;
    }


    // One state snapshot per second.
    //
    // player_state was sampled every 16 ticks,
    // so every 64 ticks is exactly one second.

    if (
        row.demoTick % 64 !== 0
    ) {
        continue;
    }


    const name =
        row.controller
            ?.playerName;

    if (!name) {
        continue;
    }

    playerNames.add(name);


    const second =
        Math.round(t);


    if (
        !frameMap.has(second)
    ) {

        frameMap.set(
            second,
            {
                t:
                    second,

                players:
                    []
            }
        );
    }


    const pawn =
        row.pawn;

    const controller =
        row.controller;


    const lifeState =
        pawn?.lifeState;


    // Prefer pawn life state here because we already
    // observed controller m_bAlive update timing lag.

    const alive =
        lifeState === 0;


    const positionValid =
        pawn?.positionValidForMovement
        === true;


    frameMap.get(
        second
    ).players.push({

        name,

        team:
            controller?.team
            ?? null,

        heroId:
            controller?.heroId
            ?? null,

        alive,

        x:
            positionValid
                ? pawn?.positionWorld?.x
                ?? null
                : null,

        y:
            positionValid
                ? pawn?.positionWorld?.y
                ?? null
                : null,

        z:
            positionValid
                ? pawn?.positionWorld?.z
                ?? null
                : null,

        health:
            pawn?.health
            ?? null,

        maxHealth:
            pawn?.maxHealth
            ?? null,

        netWorth:
            controller?.netWorth
            ?? null,

        kills:
            controller?.kills
            ?? null,

        deaths:
            controller?.deaths
            ?? null,

        assists:
            controller?.assists
            ?? null,

        lastHits:
            controller?.lastHits
            ?? null,

        denies:
            controller?.denies
            ?? null,

        lane:
            pawn?.deducedLane
            ?? null,

        assignedLane:
            controller?.assignedLane
            ?? null
    });
}


const frames =
    [...frameMap.values()]
        .sort(
            (a, b) =>
                a.t - b.t
        );


console.log(
    `Player frames: ${frames.length}`
);


// ============================================================
// TRUSTED RESOURCE INSTANCES
// ============================================================

console.log(
    'Reading resource instances...'
);


const TRUSTED_CLASSES =
    new Set([

        'CNPC_TrooperNeutral',

        'CNPC_Neutral_SinnersSacrifice',

        'CNPC_MidBoss'
    ]);


const resourcesByKey =
    new Map();


const resourceReader =
    readline.createInterface({

        input:
            createReadStream(
                resourceLifecyclePath
            ),

        crlfDelay:
            Infinity
    });


for await (
    const line
    of resourceReader
) {

    if (!line.trim()) {
        continue;
    }

    const row =
        JSON.parse(line);


    if (
        row.event !== 'CREATE'
    ) {
        continue;
    }


    if (
        !TRUSTED_CLASSES.has(
            row.className
        )
    ) {
        continue;
    }


    const createTime =
        row.fields?.m_flCreateTime;


    if (
        !Number.isFinite(
            createTime
        )
    ) {
        continue;
    }


    const logicalKey =
        [
            row.className,
            row.entityIndex,
            createTime
        ].join('|');


    if (
        resourcesByKey.has(
            logicalKey
        )
    ) {
        continue;
    }


    const subclassId =
        row.fields
            ?.m_nSubclassID
            ?? null;


    const world =
        row.position
            ?.world
            ?? {};


    resourcesByKey.set(
        logicalKey,
        {

            key:
                logicalKey,

            entityKey:
                `${row.className}|${row.entityIndex}`,

            className:
                row.className,

            entityIndex:
                row.entityIndex,

            createTime,

            subclassId,

            type:
                classifyResource(
                    row.className,
                    subclassId
                ),

            firstSeenTime:
                row.matchTimeSeconds,

            x:
                Number.isFinite(
                    world.x
                )
                    ? world.x
                    : null,

            y:
                Number.isFinite(
                    world.y
                )
                    ? world.y
                    : null,

            z:
                Number.isFinite(
                    world.z
                )
                    ? world.z
                    : null
        }
    );
}


const resources =
    [...resourcesByKey.values()]
        .sort(
            (a, b) =>
                a.firstSeenTime -
                b.firstSeenTime
        );


console.log(
    `Trusted resource instances: ${resources.length}`
);


// ============================================================
// RESOURCE TRANSITIONS
// ============================================================

console.log(
    'Reading resource transitions...'
);


const resourceTransitions =
    [];


const transitionReader =
    readline.createInterface({

        input:
            createReadStream(
                resourceTransitionPath
            ),

        crlfDelay:
            Infinity
    });


for await (
    const line
    of transitionReader
) {

    if (!line.trim()) {
        continue;
    }

    const row =
        JSON.parse(line);


    if (
        !TRUSTED_CLASSES.has(
            row.className
        )
    ) {
        continue;
    }


    resourceTransitions.push({

        entityKey:
            `${row.className}|${row.entityIndex}`,

        className:
            row.className,

        entityIndex:
            row.entityIndex,

        subclassId:
            row.subclassId
            ?? null,

        type:
            classifyResource(
                row.className,
                row.subclassId
            ),

        transition:
            row.transition,

        t:
            row.matchTimeSeconds,

        clock:
            row.matchClock,

        downtimeSeconds:
            row.downtimeSeconds
            ?? null,

        health:
            row.health
            ?? null,

        maxHealth:
            row.maxHealth
            ?? null,

        x:
            row.position?.x
            ?? null,

        y:
            row.position?.y
            ?? null,

        z:
            row.position?.z
            ?? null
    });
}


resourceTransitions.sort(
    (a, b) =>
        a.t - b.t
);


console.log(
    `Resource transitions: ${resourceTransitions.length}`
);


// ============================================================
// FINAL DATASET
// ============================================================

const bounds =
    normalizeBounds(
        playerSummary.minimapBounds
    );


const result = {

    version:
        1,

    replay:
        replayName,

    meta: {

        durationSeconds:
            playerSummary
                .finalMatchTimeSeconds,

        matchClockOffsetSeconds:
            playerSummary
                .matchClockOffsetSeconds,

        sourcePlayerIntervalSeconds:
            playerSummary
                .nominalSampleIntervalSeconds,

        inspectorPlayerIntervalSeconds:
            1,

        bounds
    },

    players:
        [...playerNames]
            .sort(),

    frames,

    resources,

    resourceTransitions
};


writeFileSync(

    destination,

    JSON.stringify(result),

    'utf8'
);


console.log('');
console.log('====================================');
console.log('INSPECTOR DATA READY');
console.log('====================================');

console.log(
    `Replay: ${replayName}`
);

console.log(
    `Players: ${result.players.length}`
);

console.log(
    `Frames: ${frames.length}`
);

console.log(
    `Resources: ${resources.length}`
);

console.log(
    `Transitions: ${resourceTransitions.length}`
);

console.log('');

console.log(
    `Output:\n${destination}`
);


// ============================================================
// HELPERS
// ============================================================

function classifyResource(
    className,
    subclassId
) {

    if (
        className ===
        'CNPC_MidBoss'
    ) {
        return 'midboss';
    }


    if (
        className ===
        'CNPC_Neutral_SinnersSacrifice'
    ) {
        return 'sinner';
    }


    if (
        className ===
        'CNPC_TrooperNeutral'
    ) {

        if (
            subclassId ===
            1250952856
        ) {
            return 'neutral-small';
        }


        if (
            subclassId ===
            941701082
        ) {
            return 'neutral-medium';
        }


        if (
            subclassId ===
            3392417854
        ) {
            return 'neutral-large';
        }


        return 'neutral-unknown';
    }


    return 'unknown';
}


function normalizeBounds(
    raw
) {

    const min =
        raw?.min ?? {};

    const max =
        raw?.max ?? {};


    return {

        minX:
            Number(
                min['0']
                ?? -10752
            ),

        minY:
            Number(
                min['1']
                ?? -10752
            ),

        maxX:
            Number(
                max['0']
                ?? 10752
            ),

        maxY:
            Number(
                max['1']
                ?? 10752
            )
    };
}