import {
    createReadStream,
    writeFileSync
} from 'node:fs';

import readline from 'node:readline';

const inputPath =
    '.\\output\\test\\renso_state.jsonl';

const outputPath =
    '.\\output\\test\\renso_verification.json';

const rl = readline.createInterface({
    input: createReadStream(inputPath),
    crlfDelay: Infinity
});

let rows = 0;
let pawnNullRows = 0;

let first = null;
let last = null;
let previous = null;

const pawnHandles = new Set();
const pawnEntityIndexes = new Set();
const heroIds = new Set();
const teams = new Set();

let minHealth = Infinity;
let maxHealth = -Infinity;
let minNetWorth = Infinity;
let maxNetWorth = -Infinity;

let positionChanges = 0;
let healthChanges = 0;
let netWorthChanges = 0;

const killChanges = [];
const deathChanges = [];
const aliveChanges = [];
const pawnHandleChanges = [];

const checkpoints = [];

for await (const line of rl) {

    if (!line.trim()) continue;

    const row = JSON.parse(line);

    rows++;

    if (!first) {
        first = compact(row);
    }

    last = compact(row);

    const c = row.controller;
    const p = row.pawn;

    if (c?.heroPawnHandle !== undefined) {
        pawnHandles.add(
            String(c.heroPawnHandle)
        );
    }

    if (c?.heroId !== undefined) {
        heroIds.add(c.heroId);
    }

    if (c?.team !== undefined) {
        teams.add(c.team);
    }

    if (!p) {

        pawnNullRows++;

    } else {

        pawnEntityIndexes.add(
            p.entityIndex
        );

        if (Number.isFinite(p.health)) {
            minHealth =
                Math.min(minHealth, p.health);

            maxHealth =
                Math.max(maxHealth, p.health);
        }
    }

    if (Number.isFinite(c?.netWorth)) {

        minNetWorth =
            Math.min(
                minNetWorth,
                c.netWorth
            );

        maxNetWorth =
            Math.max(
                maxNetWorth,
                c.netWorth
            );
    }


    // --------------------------------------
    // Compare against previous sample
    // --------------------------------------

    if (previous) {

        const pc = previous.controller;
        const pp = previous.pawn;


        // Position movement
        if (
            p &&
            pp &&
            JSON.stringify(p.positionRaw) !==
            JSON.stringify(pp.positionRaw)
        ) {
            positionChanges++;
        }


        // Health movement
        if (
            p?.health !==
            pp?.health
        ) {
            healthChanges++;
        }


        // Net worth movement
        if (
            c?.netWorth !==
            pc?.netWorth
        ) {
            netWorthChanges++;
        }


        // Kill transition
        if (
            c?.kills !==
            pc?.kills
        ) {
            killChanges.push({
                tick: row.demoTick,
                replaySeconds:
                    row.replaySeconds,
                from: pc?.kills,
                to: c?.kills,
                netWorth:
                    c?.netWorth,
                position:
                    p?.positionRaw ?? null
            });
        }


        // Death counter transition
        if (
            c?.deaths !==
            pc?.deaths
        ) {
            deathChanges.push({
                tick: row.demoTick,
                replaySeconds:
                    row.replaySeconds,
                from: pc?.deaths,
                to: c?.deaths,
                health:
                    p?.health ?? null,
                lifeState:
                    p?.lifeState ?? null,
                deathTime:
                    p?.deathTime ?? null,
                respawnTime:
                    p?.respawnTime ?? null,
                position:
                    p?.positionRaw ?? null
            });
        }


        // Alive/dead state transition
        if (
            c?.alive !==
            pc?.alive
        ) {
            aliveChanges.push({
                tick: row.demoTick,
                replaySeconds:
                    row.replaySeconds,
                from: pc?.alive,
                to: c?.alive,
                health:
                    p?.health ?? null,
                lifeState:
                    p?.lifeState ?? null,
                deathTime:
                    p?.deathTime ?? null,
                respawnTime:
                    p?.respawnTime ?? null
            });
        }


        // Pawn handle changed
        if (
            String(c?.heroPawnHandle) !==
            String(pc?.heroPawnHandle)
        ) {
            pawnHandleChanges.push({
                tick: row.demoTick,
                replaySeconds:
                    row.replaySeconds,
                from:
                    pc?.heroPawnHandle,
                to:
                    c?.heroPawnHandle
            });
        }
    }


    // Rough checkpoint every 60 seconds
    if (
        rows === 1 ||
        (
            previous &&
            Math.floor(
                row.replaySeconds / 60
            ) !==
            Math.floor(
                previous.replaySeconds / 60
            )
        )
    ) {
        checkpoints.push(
            compact(row)
        );
    }

    previous = row;
}


// ------------------------------------------
// RESULTS
// ------------------------------------------

const result = {

    rows,

    first,
    last,

    identity: {
        playerName:
            first?.playerName,

        heroIds:
            [...heroIds],

        teams:
            [...teams],

        uniquePawnHandles:
            [...pawnHandles],

        uniquePawnEntityIndexes:
            [...pawnEntityIndexes],

        pawnNullRows
    },

    ranges: {
        health: {
            min:
                finiteOrNull(minHealth),
            max:
                finiteOrNull(maxHealth)
        },

        netWorth: {
            min:
                finiteOrNull(minNetWorth),
            max:
                finiteOrNull(maxNetWorth)
        }
    },

    changeCounts: {
        positionChanges,
        healthChanges,
        netWorthChanges,
        killChanges:
            killChanges.length,
        deathChanges:
            deathChanges.length,
        aliveChanges:
            aliveChanges.length,
        pawnHandleChanges:
            pawnHandleChanges.length
    },

    killChanges,
    deathChanges,
    aliveChanges,
    pawnHandleChanges,

    checkpoints
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
console.log('Verification complete.');
console.log('');
console.log(`Rows: ${rows}`);
console.log(
    `Pawn-null rows: ${pawnNullRows}`
);
console.log(
    `Position changes: ${positionChanges}`
);
console.log(
    `Health changes: ${healthChanges}`
);
console.log(
    `Net-worth changes: ${netWorthChanges}`
);
console.log(
    `Kills detected: ${killChanges.length}`
);
console.log(
    `Deaths detected: ${deathChanges.length}`
);
console.log(
    `Alive transitions: ${aliveChanges.length}`
);
console.log(
    `Pawn handle changes: ${pawnHandleChanges.length}`
);
console.log('');
console.log(`Output: ${outputPath}`);


function compact(row) {

    return {
        tick:
            row.demoTick,

        replaySeconds:
            row.replaySeconds,

        playerName:
            row.controller?.playerName,

        heroId:
            row.controller?.heroId,

        team:
            row.controller?.team,

        alive:
            row.controller?.alive,

        kills:
            row.controller?.kills,

        deaths:
            row.controller?.deaths,

        assists:
            row.controller?.assists,

        netWorth:
            row.controller?.netWorth,

        pawnHandle:
            row.controller?.heroPawnHandle,

        pawnEntityIndex:
            row.pawn?.entityIndex ?? null,

        health:
            row.pawn?.health ?? null,

        maxHealth:
            row.pawn?.maxHealth ?? null,

        lifeState:
            row.pawn?.lifeState ?? null,

        position:
            row.pawn?.positionRaw ?? null,

        eyeAngles:
            row.pawn?.eyeAngles ?? null
    };
}


function finiteOrNull(value) {

    return Number.isFinite(value)
        ? value
        : null;
}