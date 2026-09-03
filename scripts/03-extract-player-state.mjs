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
    InterceptorStage,
    Logger,
    Parser,
    ParserConfiguration
} from 'deadem';


// ============================================================
// SETTINGS
// ============================================================

const TICKS_PER_SECOND = 64;

// 4 samples per second
const SAMPLE_EVERY_TICKS = 16;

// Confirmed from the replay coordinate sanity check
const CELL_SIZE = 512;
const WORLD_OFFSET = 16384;


// ============================================================
// INPUT
// ============================================================

const replayPath = process.argv[2];

if (!replayPath) {
    console.error(
        'Usage: node scripts/03-extract-player-state.mjs replays/test.dem'
    );
    process.exit(1);
}

const absolutePath = resolve(replayPath);

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

const statePath =
    join(
        outputDir,
        'player_state.jsonl'
    );

const summaryPath =
    join(
        outputDir,
        'player_state_summary.json'
    );

const stateOutput =
    createWriteStream(
        statePath,
        {
            encoding: 'utf8'
        }
    );


// ============================================================
// PARSER
// ============================================================

const config =
    new ParserConfiguration({
        entityClasses: [
            'CCitadelPlayerController',
            'CCitadelPlayerPawn',
            'CCitadelGameRulesProxy'
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

let lastSampleTick = -1;

let recordsWritten = 0;

let firstSampleTick = null;
let finalSampleTick = null;

let firstMatchTime = null;
let finalMatchTime = null;

// This should end up around 30 seconds.
// We determine it from the replay itself.
let matchClockOffsetSeconds = null;

let minimapBounds = null;

const playerNamesSeen =
    new Set();

const heroIdsSeen =
    new Set();


// ============================================================
// SAMPLE STATE
// ============================================================

parser.registerPostInterceptor(
    InterceptorStage.DEMO_PACKET,
    (demoPacket) => {

        const tick =
            demoPacket.tick;

        if (
            tick === undefined ||
            tick === null ||
            tick < 0
        ) {
            return;
        }

        if (
            tick === lastSampleTick
        ) {
            return;
        }

        if (
            tick %
            SAMPLE_EVERY_TICKS !==
            0
        ) {
            return;
        }

        lastSampleTick =
            tick;

        const demo =
            parser.getDemo();


        // ====================================================
        // GAME RULES / CLOCK
        // ====================================================

        const rulesList =
            demo.getEntitiesByClassName(
                'CCitadelGameRulesProxy'
            );

        const rules =
            rulesList.length > 0
                ? rulesList[0]
                : null;


        let gameStartTime = null;
        let gameStateStartTime = null;
        let gameState = null;

        if (rules) {

            gameStartTime =
                rules.getField(
                    'm_pGameRules.m_flGameStartTime'
                );

            gameStateStartTime =
                rules.getField(
                    'm_pGameRules.m_flGameStateStartTime'
                );

            gameState =
                rules.getField(
                    'm_pGameRules.m_eGameState'
                );


            // Determine the replay-to-match-clock offset once.
            //
            // In the test replay this is approximately:
            //
            // 61.18 - 31.17 ≈ 30 seconds
            //
            // Meaning:
            //
            // demo time 30 sec ≈ match time 0:00

            if (
                matchClockOffsetSeconds === null &&
                Number.isFinite(gameStartTime) &&
                Number.isFinite(gameStateStartTime)
            ) {

                matchClockOffsetSeconds =
                    gameStartTime -
                    gameStateStartTime;
            }


            // Save minimap bounds once.

            if (
                minimapBounds === null
            ) {

                const min =
                    rules.getField(
                        'm_pGameRules.m_vMinimapMins'
                    );

                const max =
                    rules.getField(
                        'm_pGameRules.m_vMinimapMaxs'
                    );

                if (
                    min !== undefined &&
                    max !== undefined
                ) {

                    minimapBounds = {
                        min:
                            safeValue(min),

                        max:
                            safeValue(max)
                    };
                }
            }
        }


        // ====================================================
        // TIME
        // ====================================================

        const demoSeconds =
            tick /
            TICKS_PER_SECOND;


        let matchTimeSeconds =
            null;

        if (
            Number.isFinite(
                matchClockOffsetSeconds
            )
        ) {

            matchTimeSeconds =
                demoSeconds -
                matchClockOffsetSeconds;
        }


        const matchMinute =
            Number.isFinite(
                matchTimeSeconds
            )
                ? matchTimeSeconds / 60
                : null;


        const matchClock =
            Number.isFinite(
                matchTimeSeconds
            )
                ? formatMatchClock(
                    matchTimeSeconds
                )
                : null;


        // ====================================================
        // PLAYERS
        // ====================================================

        const controllers =
            demo.getEntitiesByClassName(
                'CCitadelPlayerController'
            );


        for (
            const controller
            of controllers
        ) {

            const playerName =
                controller.getField(
                    'm_iszPlayerName'
                );

            if (
                !playerName ||
                playerName === 'SourceTV'
            ) {
                continue;
            }

            playerNamesSeen.add(
                playerName
            );


            // =================================================
            // PAWN LINK
            // =================================================

            let pawnHandle =
                controller.getField(
                    'm_hHeroPawn'
                );


            if (
                pawnHandle === undefined ||
                pawnHandle === null ||
                pawnHandle === 16777215
            ) {

                pawnHandle =
                    controller.getField(
                        'm_hPawn'
                    );
            }


            let pawn = null;

            if (
                pawnHandle !== undefined &&
                pawnHandle !== null &&
                pawnHandle !== 16777215
            ) {

                try {

                    pawn =
                        demo.getEntityByHandle(
                            pawnHandle
                        );

                } catch {

                    pawn = null;
                }
            }


            // =================================================
            // CONTROLLER
            // =================================================

            const heroId =
                controller.getField(
                    'm_nHeroID'
                );


            if (
                heroId !== undefined &&
                heroId !== null &&
                heroId !== 0
            ) {

                heroIdsSeen.add(
                    heroId
                );
            }


            const alive =
                controller.getField(
                    'm_bAlive'
                );


            const controllerState = {

                entityIndex:
                    controller.index,

                playerName,

                steamId:
                    safeValue(
                        controller.getField(
                            'm_steamID'
                        )
                    ),

                team:
                    controller.getField(
                        'm_iTeamNum'
                    ),

                heroId,

                alive,

                // Keep these for comparison.
                // Do NOT assume they are canonical HP yet.

                health:
                    controller.getField(
                        'm_iHealth'
                    ),

                maxHealth:
                    controller.getField(
                        'm_iHealthMax'
                    ),

                level:
                    controller.getField(
                        'm_iLevel'
                    ),

                netWorth:
                    controller.getField(
                        'm_iGoldNetWorth'
                    ),

                abilityPointNetWorth:
                    controller.getField(
                        'm_iAPNetWorth'
                    ),

                kills:
                    controller.getField(
                        'm_iPlayerKills'
                    ),

                deaths:
                    controller.getField(
                        'm_iDeaths'
                    ),

                assists:
                    controller.getField(
                        'm_iPlayerAssists'
                    ),

                killStreak:
                    controller.getField(
                        'm_iKillStreak'
                    ),

                lastHits:
                    controller.getField(
                        'm_iLastHits'
                    ),

                denies:
                    controller.getField(
                        'm_iDenies'
                    ),

                assignedLane:
                    controller.getField(
                        'm_nAssignedLane'
                    ),

                heroDamage:
                    controller.getField(
                        'm_iHeroDamage'
                    ),

                heroHealing:
                    controller.getField(
                        'm_iHeroHealing'
                    ),

                selfHealing:
                    controller.getField(
                        'm_iSelfHealing'
                    ),

                objectiveDamage:
                    controller.getField(
                        'm_iObjectiveDamage'
                    ),

                respawnTime:
                    controller.getField(
                        'm_flRespawnTime'
                    ),

                hasRejuvenator:
                    controller.getField(
                        'm_bHasRejuvenator'
                    ),

                heroPawnHandle:
                    safeValue(
                        pawnHandle
                    )
            };


            // =================================================
            // PAWN
            // =================================================

            let pawnState =
                null;


            if (pawn) {

                const cellX =
                    pawn.getField(
                        'CBodyComponent.m_cellX'
                    );

                const cellY =
                    pawn.getField(
                        'CBodyComponent.m_cellY'
                    );

                const cellZ =
                    pawn.getField(
                        'CBodyComponent.m_cellZ'
                    );

                const vecX =
                    pawn.getField(
                        'CBodyComponent.m_vecX'
                    );

                const vecY =
                    pawn.getField(
                        'CBodyComponent.m_vecY'
                    );

                const vecZ =
                    pawn.getField(
                        'CBodyComponent.m_vecZ'
                    );


                const worldX =
                    decodeCoordinate(
                        cellX,
                        vecX
                    );

                const worldY =
                    decodeCoordinate(
                        cellY,
                        vecY
                    );

                const worldZ =
                    decodeCoordinate(
                        cellZ,
                        vecZ
                    );


                const lifeState =
                    pawn.getField(
                        'm_lifeState'
                    );


                // We learned that dead pawns move to a
                // holding/base coordinate.
                //
                // Therefore dead positions must NOT be used
                // for movement/path analysis.

                const positionValidForMovement =
                    alive === true &&
                    lifeState === 0;


                pawnState = {

                    entityIndex:
                        pawn.index,

                    heroId:
                        pawn.getField(
                            'm_nHeroID'
                        ),

                    team:
                        pawn.getField(
                            'm_iTeamNum'
                        ),

                    health:
                        pawn.getField(
                            'm_iHealth'
                        ),

                    maxHealth:
                        pawn.getField(
                            'm_iMaxHealth'
                        ),

                    lifeState,

                    simulationTime:
                        pawn.getField(
                            'm_flSimulationTime'
                        ),

                    lastDamageTime:
                        pawn.getField(
                            'm_flLastDamageTime'
                        ),

                    deathTime:
                        pawn.getField(
                            'm_flDeathTime'
                        ),

                    respawnTime:
                        pawn.getField(
                            'm_flRespawnTime'
                        ),

                    lastSpawnTime:
                        pawn.getField(
                            'm_flLastSpawnTime'
                        ),


                    // -----------------------------------------
                    // RAW SOURCE 2 POSITION
                    // -----------------------------------------

                    positionRaw: {

                        cellX,
                        cellY,
                        cellZ,

                        vecX,
                        vecY,
                        vecZ
                    },


                    // -----------------------------------------
                    // DECODED WORLD POSITION
                    // -----------------------------------------

                    positionWorld: {

                        x:
                            worldX,

                        y:
                            worldY,

                        z:
                            worldZ
                    },


                    positionValidForMovement,


                    // -----------------------------------------
                    // CAMERA / FACING
                    // -----------------------------------------

                    bodyRotation:
                        safeValue(
                            pawn.getField(
                                'CBodyComponent.m_angRotation'
                            )
                        ),

                    eyeAngles:
                        safeValue(
                            pawn.getField(
                                'm_angEyeAngles'
                            )
                        ),

                    cameraAngles:
                        safeValue(
                            pawn.getField(
                                'm_angClientCamera'
                            )
                        ),


                    // -----------------------------------------
                    // ENVIRONMENT
                    // -----------------------------------------

                    moveType:
                        pawn.getField(
                            'm_MoveType'
                        ),

                    movementFlags:
                        pawn.getField(
                            'm_fFlags'
                        ),

                    groundEntity:
                        safeValue(
                            pawn.getField(
                                'm_hGroundEntity'
                            )
                        ),

                    deducedLane:
                        pawn.getField(
                            'm_nDeducedLane'
                        ),

                    inRegenZone:
                        pawn.getField(
                            'm_bInRegenerationZone'
                        ),

                    inItemShopZone:
                        pawn.getField(
                            'm_bInItemShopZone'
                        ),

                    inHideoutZone:
                        pawn.getField(
                            'm_bInHideoutZone'
                        ),

                    ziplineLane:
                        pawn.getField(
                            'm_eZipLineLaneColor'
                        ),


                    // -----------------------------------------
                    // ABILITIES
                    // -----------------------------------------

                    selectedAbility:
                        safeValue(
                            pawn.getField(
                                'm_hSelectedAbility'
                            )
                        ),

                    previousSelectedAbility:
                        safeValue(
                            pawn.getField(
                                'm_hPreviouslySelectedAbility'
                            )
                        ),

                    channelingAbility:
                        safeValue(
                            pawn.getField(
                                'm_hChannellingAbility'
                            )
                        ),

                    castDelayingAbility:
                        safeValue(
                            pawn.getField(
                                'm_hCastDelayingAbility'
                            )
                        ),

                    inInterruptState:
                        pawn.getField(
                            'm_bInInterruptState'
                        ),


                    // -----------------------------------------
                    // RAW CURRENCY BUCKETS
                    // -----------------------------------------

                    currencies: [

                        pawn.getField(
                            'm_nCurrencies.0000'
                        ),

                        pawn.getField(
                            'm_nCurrencies.0001'
                        ),

                        pawn.getField(
                            'm_nCurrencies.0002'
                        ),

                        pawn.getField(
                            'm_nCurrencies.0003'
                        ),

                        pawn.getField(
                            'm_nCurrencies.0004'
                        ),

                        pawn.getField(
                            'm_nCurrencies.0005'
                        )
                    ],

                    spentCurrencies: [

                        pawn.getField(
                            'm_nSpentCurrencies.0000'
                        ),

                        pawn.getField(
                            'm_nSpentCurrencies.0001'
                        ),

                        pawn.getField(
                            'm_nSpentCurrencies.0002'
                        ),

                        pawn.getField(
                            'm_nSpentCurrencies.0003'
                        ),

                        pawn.getField(
                            'm_nSpentCurrencies.0004'
                        ),

                        pawn.getField(
                            'm_nSpentCurrencies.0005'
                        )
                    ]
                };
            }


            // =================================================
            // RECORD
            // =================================================

            const record = {

                demoTick:
                    tick,

                demoSeconds,

                // Negative values = pregame.
                //
                // 0 = official match start.

                matchTimeSeconds,

                matchMinute,

                matchClock,

                isPregame:
                    Number.isFinite(
                        matchTimeSeconds
                    )
                        ? matchTimeSeconds < 0
                        : null,

                gameState,

                controller:
                    controllerState,

                pawn:
                    pawnState
            };


            stateOutput.write(
                JSON.stringify(record) +
                '\n'
            );

            recordsWritten++;


            if (
                firstSampleTick === null
            ) {

                firstSampleTick =
                    tick;
            }

            finalSampleTick =
                tick;


            if (
                Number.isFinite(
                    matchTimeSeconds
                )
            ) {

                if (
                    firstMatchTime === null
                ) {

                    firstMatchTime =
                        matchTimeSeconds;
                }

                finalMatchTime =
                    matchTimeSeconds;
            }
        }
    }
);


// ============================================================
// RUN
// ============================================================

console.log('');
console.log('====================================');
console.log('Deadlock Player State Extractor v2');
console.log('====================================');
console.log(`Replay: ${absolutePath}`);
console.log('');
console.log(
    `Sampling every ${SAMPLE_EVERY_TICKS} ticks`
);
console.log('');


try {

    await parser.parse(
        createReadStream(
            absolutePath
        )
    );


    const summary = {

        replay:
            replayName,

        tickRateAssumed:
            TICKS_PER_SECOND,

        sampleEveryTicks:
            SAMPLE_EVERY_TICKS,

        nominalSampleIntervalSeconds:
            SAMPLE_EVERY_TICKS /
            TICKS_PER_SECOND,

        coordinateFormula:
            'world = cell * 512 - 16384 + vec',

        matchClockOffsetSeconds,

        firstSampleTick,

        finalSampleTick,

        firstMatchTimeSeconds:
            firstMatchTime,

        finalMatchTimeSeconds:
            finalMatchTime,

        recordsWritten,

        playersSeen:
            [...playerNamesSeen]
                .sort(),

        heroIdsSeen:
            [...heroIdsSeen]
                .sort(
                    (a, b) =>
                        a - b
                ),

        minimapBounds
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
    console.log('EXTRACTION COMPLETE');
    console.log('====================================');

    console.log(
        `Records written: ${recordsWritten}`
    );

    console.log(
        `Match clock offset: ${matchClockOffsetSeconds}`
    );

    console.log(
        `First match time: ${firstMatchTime}`
    );

    console.log(
        `Final match time: ${finalMatchTime}`
    );

    console.log('');

    console.log(
        `Player states:\n${statePath}`
    );

    console.log('');

    console.log(
        `Summary:\n${summaryPath}`
    );


} catch (error) {

    console.error('');
    console.error('====================================');
    console.error('EXTRACTION FAILED');
    console.error('====================================');

    console.error(error);

    process.exitCode = 1;

} finally {

    await parser.dispose();

    await new Promise(
        resolvePromise => {

            stateOutput.end(
                resolvePromise
            );
        }
    );
}


// ============================================================
// HELPERS
// ============================================================

function decodeCoordinate(
    cell,
    local
) {

    if (
        !Number.isFinite(cell) ||
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


function formatMatchClock(
    seconds
) {

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
        value === undefined ||
        value === null
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
                safeValue(child);
        }

        return result;
    }

    return value;
}