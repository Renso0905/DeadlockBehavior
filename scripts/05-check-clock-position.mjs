import {
    createReadStream,
    writeFileSync
} from 'node:fs';

import {
    InterceptorStage,
    Logger,
    Parser,
    ParserConfiguration
} from 'deadem';

const replayPath = process.argv[2];

if (!replayPath) {
    console.error(
        'Usage: node scripts/05-check-clock-position.mjs replays/test.dem'
    );
    process.exit(1);
}

const TICK_RATE = 64;
const CELL_SIZE = 512;
const WORLD_OFFSET = 16384;

const config = new ParserConfiguration({
    entityClasses: [
        'CCitadelPlayerController',
        'CCitadelPlayerPawn',
        'CCitadelGameRulesProxy'
    ]
});

const parser = new Parser(
    config,
    Logger.CONSOLE_WARN
);

const checkpoints = [];

let lastMinute = null;
let previousDeaths = null;

parser.registerPostInterceptor(
    InterceptorStage.DEMO_PACKET,
    (packet) => {

        const tick = packet.tick;

        if (tick < 0) return;

        const demo = parser.getDemo();

        const controllers =
            demo.getEntitiesByClassName(
                'CCitadelPlayerController'
            );

        const controller =
            controllers.find(
                c =>
                    c.getField('m_iszPlayerName')
                    === 'renso'
            );

        if (!controller) return;

        const rules =
            demo.getEntitiesByClassName(
                'CCitadelGameRulesProxy'
            )[0];

        if (!rules) return;

        const pawnHandle =
            controller.getField('m_hHeroPawn');

        let pawn = null;

        if (
            pawnHandle !== undefined &&
            pawnHandle !== 16777215
        ) {
            try {
                pawn =
                    demo.getEntityByHandle(
                        pawnHandle
                    );
            } catch {}
        }

        if (!pawn) return;


        // =====================================
        // ACTUAL MATCH CLOCK
        // =====================================

        const serverTick =
            controller.getField(
                'm_nTickBase'
            );

        const clockUpdateTick =
            rules.getField(
                'm_pGameRules.m_nMatchClockUpdateTick'
            );

        const clockAtUpdate =
            rules.getField(
                'm_pGameRules.m_flMatchClockAtLastUpdate'
            );

        const paused =
            rules.getField(
                'm_pGameRules.m_bGamePaused'
            );

        const pauseStartTick =
            rules.getField(
                'm_pGameRules.m_nPauseStartTick'
            );

        let effectiveServerTick =
            serverTick;

        if (
            paused &&
            Number.isFinite(pauseStartTick) &&
            pauseStartTick > 0
        ) {
            effectiveServerTick =
                pauseStartTick;
        }

        let matchClock = null;

        if (
            Number.isFinite(effectiveServerTick) &&
            Number.isFinite(clockUpdateTick) &&
            Number.isFinite(clockAtUpdate)
        ) {
            matchClock =
                clockAtUpdate +
                (
                    effectiveServerTick -
                    clockUpdateTick
                ) / TICK_RATE;
        }


        // =====================================
        // WORLD COORDINATES
        // =====================================

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
            decodeCoordinate(cellX, vecX);

        const worldY =
            decodeCoordinate(cellY, vecY);

        const worldZ =
            decodeCoordinate(cellZ, vecZ);


        // =====================================
        // MINIMAP BOUNDS
        // =====================================

        const minimapMin =
            rules.getField(
                'm_pGameRules.m_vMinimapMins'
            );

        const minimapMax =
            rules.getField(
                'm_pGameRules.m_vMinimapMaxs'
            );


        // =====================================
        // DECIDE WHETHER TO SAVE CHECKPOINT
        // =====================================

        const deaths =
            controller.getField(
                'm_iDeaths'
            );

        const minute =
            matchClock === null
                ? null
                : Math.floor(matchClock / 60);

        const minuteChanged =
            minute !== null &&
            minute !== lastMinute;

        const deathChanged =
            previousDeaths !== null &&
            deaths !== previousDeaths;

        if (
            checkpoints.length === 0 ||
            minuteChanged ||
            deathChanged
        ) {

            checkpoints.push({

                demoTick:
                    tick,

                replaySeconds:
                    tick / TICK_RATE,

                serverTick,

                matchClock,

                gameState:
                    rules.getField(
                        'm_pGameRules.m_eGameState'
                    ),

                gameStartTime:
                    rules.getField(
                        'm_pGameRules.m_flGameStartTime'
                    ),

                matchClockUpdateTick:
                    clockUpdateTick,

                matchClockAtLastUpdate:
                    clockAtUpdate,

                paused,

                player: {

                    alive:
                        controller.getField(
                            'm_bAlive'
                        ),

                    kills:
                        controller.getField(
                            'm_iPlayerKills'
                        ),

                    deaths,

                    controllerHealth:
                        controller.getField(
                            'm_iHealth'
                        ),

                    controllerMaxHealth:
                        controller.getField(
                            'm_iHealthMax'
                        ),

                    pawnHealth:
                        pawn.getField(
                            'm_iHealth'
                        ),

                    pawnMaxHealth:
                        pawn.getField(
                            'm_iMaxHealth'
                        )
                },

                rawPosition: {
                    cellX,
                    cellY,
                    cellZ,
                    vecX,
                    vecY,
                    vecZ
                },

                worldPosition: {
                    x: worldX,
                    y: worldY,
                    z: worldZ
                },

                minimapBounds: {
                    min: minimapMin,
                    max: minimapMax
                },

                insideMinimapXY:
                    insideBounds(
                        worldX,
                        worldY,
                        minimapMin,
                        minimapMax
                    )
            });
        }

        if (minuteChanged) {
            lastMinute = minute;
        }

        previousDeaths = deaths;
    }
);

try {

    await parser.parse(
        createReadStream(replayPath)
    );

    const result = {
        formula:
            'world = cell * 512 - 16384 + vec',

        checkpoints
    };

    const output =
        '.\\output\\test\\clock_position_check.json';

    writeFileSync(
        output,
        JSON.stringify(
            result,
            null,
            2
        ),
        'utf8'
    );

    console.log('');
    console.log('Check complete.');
    console.log(
        `Checkpoints: ${checkpoints.length}`
    );
    console.log(`Output: ${output}`);

} finally {

    await parser.dispose();
}


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
        cell * CELL_SIZE -
        WORLD_OFFSET +
        local
    );
}


function insideBounds(
    x,
    y,
    min,
    max
) {

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !min ||
        !max
    ) {
        return null;
    }

    return (
        x >= min[0] &&
        x <= max[0] &&
        y >= min[1] &&
        y <= max[1]
    );
}