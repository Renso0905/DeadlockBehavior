import {
    createReadStream,
    readFileSync,
    writeFileSync,
    existsSync
} from 'node:fs';

import { resolve } from 'node:path';

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


const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );

const inputMeleePath =
    resolve(
        'output',
        replayName,
        'melee_events.jsonl'
    );

const verifiedPath =
    resolve(
        'output',
        replayName,
        'verified_melee_events.jsonl'
    );

const summaryPath =
    resolve(
        'output',
        replayName,
        'melee_verification_summary.json'
    );

const sinnerPath =
    resolve(
        'output',
        replayName,
        'sinner_melee_crosscheck.json'
    );


// ============================================================
// ENUMS FROM DEADLOCK SCHEMA
// ============================================================

const ATTACK_TYPE = {

    0: 'NONE',

    1: 'LIGHT',

    2: 'HEAVY',

    3: 'HEAVY_AIR',

    4: 'SLIDE'
};


const ATTACK_STATE = {

    0: 'NONE',

    1: 'CHARGING',

    2: 'GROUND_DASHING',

    3: 'AIR_DASHING',

    4: 'ATTACKING',

    5: 'SLIDE_DASHING'
};


// ============================================================
// LOAD OUR RAW INPUT-BASED MELEE EVENTS
// ============================================================

const inputEvents =
    existsSync(inputMeleePath)

        ? readJsonl(
            inputMeleePath
        )

        : [];


console.log('');
console.log(
    `Input melee events loaded: ${inputEvents.length}`
);


// ============================================================
// PARSER
// ============================================================

const parser =
    new Parser();


// ============================================================
// DIRECT MELEE EVENTS
// ============================================================

// Key:
// ability entity index | attack triggered time | attack type

const directEvents =
    new Map();


// ============================================================
// SINNER STATE
// ============================================================

const sinnerPrevious =
    new Map();

const sinnerHealthChanges =
    [];

const sinnerDowns =
    [];


// ============================================================
// SNAPSHOT EVERY DEMO PACKET
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.DEMO_PACKET,

    demoPacket => {

        const tick =
            demoPacket.tick;


        if (
            !Number.isFinite(tick)
        ) {
            return;
        }


        const matchTime =
            tickToMatchTime(
                tick
            );


        const demo =
            parser.getDemo();


        // ====================================================
        // MELEE ABILITY STATE
        // ====================================================

        const meleeAbilities =
            demo.getEntitiesByClassName(
                'CCitadel_Ability_HoldMelee'
            );


        for (
            const ability
            of meleeAbilities
        ) {

            const attackType =
                numberField(
                    ability,
                    'm_eCurrentAttackType'
                );


            const attackState =
                numberField(
                    ability,
                    'm_eCurrentAttackState'
                );


            const triggeredTime =
                numberField(
                    ability,
                    'm_flAttackTriggeredTime'
                );


            const hit =
                booleanField(
                    ability,
                    'm_bHitWithThisAttack'
                );


            if (
                !Number.isFinite(
                    triggeredTime
                )
                ||
                triggeredTime <= 0
                ||
                !Number.isFinite(
                    attackType
                )
                ||
                attackType <= 0
            ) {

                continue;
            }


            const key =
                [
                    ability.index,
                    triggeredTime,
                    attackType
                ]
                .join('|');


            const owner =
                resolveMeleeOwner(
                    demo,
                    ability
                );


            if (
                !directEvents.has(
                    key
                )
            ) {

                const position =
                    worldPosition(
                        owner.pawn
                    );


                directEvents.set(
                    key,
                    {

                        key,

                        abilityEntityIndex:
                            ability.index,

                        ownerHandle:
                            owner.ownerHandle,

                        pawnEntityIndex:
                            owner.pawn?.index
                            ?? null,

                        controllerEntityIndex:
                            owner.controller?.index
                            ?? null,

                        playerName:
                            owner.playerName,

                        heroId:
                            owner.heroId,

                        team:
                            owner.team,

                        attackTypeCode:
                            attackType,

                        attackType:
                            ATTACK_TYPE[
                                attackType
                            ]
                            ??
                            `UNKNOWN_${attackType}`,

                        firstAttackStateCode:
                            attackState,

                        firstAttackState:
                            ATTACK_STATE[
                                attackState
                            ]
                            ??
                            `UNKNOWN_${attackState}`,

                        attackTriggeredTime:
                            triggeredTime,

                        firstObservedTick:
                            tick,

                        firstObservedMatchTimeSeconds:
                            matchTime,

                        firstObservedClock:
                            formatClock(
                                matchTime
                            ),

                        attackPosition:
                            position,

                        hit:
                            false,

                        hitObservedTick:
                            null,

                        hitObservedMatchTimeSeconds:
                            null,

                        hitObservedClock:
                            null,

                        hitPosition:
                            null
                    }
                );
            }


            const event =
                directEvents.get(
                    key
                );


            if (
                hit === true
                &&
                event.hit !== true
            ) {

                event.hit =
                    true;


                event.hitObservedTick =
                    tick;


                event.hitObservedMatchTimeSeconds =
                    matchTime;


                event.hitObservedClock =
                    formatClock(
                        matchTime
                    );


                event.hitPosition =
                    worldPosition(
                        owner.pawn
                    );
            }
        }


        // ====================================================
        // SINNER STATE
        // ====================================================

        const sinners =
            demo.getEntitiesByClassName(
                'CNPC_Neutral_SinnersSacrifice'
            );


        for (
            const sinner
            of sinners
        ) {

            const health =
                numberField(
                    sinner,
                    'm_iHealth'
                );


            const maxHealth =
                numberField(
                    sinner,
                    'm_iMaxHealth'
                );


            const vaultState =
                numberField(
                    sinner,
                    'm_iVaultState'
                );


            const lifeState =
                numberField(
                    sinner,
                    'm_lifeState'
                );


            const position =
                worldPosition(
                    sinner
                );


            const current = {

                health,

                maxHealth,

                vaultState,

                lifeState,

                depleted:
                    vaultState === 6
                    ||
                    (
                        Number.isFinite(
                            health
                        )
                        &&
                        health <= 0
                    )
            };


            const previous =
                sinnerPrevious.get(
                    sinner.index
                );


            if (!previous) {

                sinnerPrevious.set(
                    sinner.index,
                    current
                );

                continue;
            }


            if (
                Number.isFinite(
                    previous.health
                )
                &&
                Number.isFinite(
                    health
                )
                &&
                health <
                    previous.health
            ) {

                sinnerHealthChanges.push({

                    sinnerEntityIndex:
                        sinner.index,

                    tick,

                    matchTimeSeconds:
                        matchTime,

                    matchClock:
                        formatClock(
                            matchTime
                        ),

                    healthBefore:
                        previous.health,

                    healthAfter:
                        health,

                    healthDelta:
                        health
                        -
                        previous.health,

                    vaultState,

                    position
                });
            }


            if (
                previous.depleted ===
                    false
                &&
                current.depleted ===
                    true
            ) {

                sinnerDowns.push({

                    sinnerEntityIndex:
                        sinner.index,

                    tick,

                    matchTimeSeconds:
                        matchTime,

                    matchClock:
                        formatClock(
                            matchTime
                        ),

                    health,

                    vaultState,

                    position
                });
            }


            sinnerPrevious.set(
                sinner.index,
                current
            );
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Parsing direct melee state + Sinners...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// DIRECT EVENTS
// ============================================================

const verifiedEvents =
    [...directEvents.values()]
        .sort(
            (
                a,
                b
            ) =>
                a.firstObservedTick
                -
                b.firstObservedTick
        );


// ============================================================
// MATCH DIRECT ATTACKS TO RAW INPUT EVENTS
// ============================================================

matchInputsToDirectEvents(
    verifiedEvents,
    inputEvents
);


// ============================================================
// MATCH SINNER HEALTH CHANGES TO ACTUAL MELEE HITS
// ============================================================

const sinnerHealthMatches =
    sinnerHealthChanges.map(
        change =>
            crosscheckSinnerEvent(
                change,
                verifiedEvents
            )
    );


const sinnerDownMatches =
    sinnerDowns.map(
        down =>
            crosscheckSinnerEvent(
                down,
                verifiedEvents
            )
    );


// ============================================================
// WRITE DIRECT EVENTS
// ============================================================

writeFileSync(

    verifiedPath,

    verifiedEvents
        .map(
            event =>
                JSON.stringify(
                    event
                )
        )
        .join('\n')
    +
    '\n',

    'utf8'
);


// ============================================================
// SUMMARY
// ============================================================

const byType =
    countBy(
        verifiedEvents,
        event =>
            event.attackType
    );


const hitsByType =
    countBy(
        verifiedEvents.filter(
            event =>
                event.hit
        ),
        event =>
            event.attackType
    );


const inputAgreement =
    buildInputAgreement(
        verifiedEvents
    );


const summary = {

    replay:
        replayName,

    directMeleeSource:
        'CCitadel_Ability_HoldMelee',

    attackTypeEnum: {

        0:
            'NONE',

        1:
            'LIGHT',

        2:
            'HEAVY',

        3:
            'HEAVY_AIR',

        4:
            'SLIDE'
    },

    totalDirectAttacks:
        verifiedEvents.length,

    attacksByType:
        byType,

    confirmedHits:
        verifiedEvents.filter(
            event =>
                event.hit
        ).length,

    confirmedHitsByType:
        hitsByType,

    inputEventsLoaded:
        inputEvents.length,

    directEventsMatchedToInput:
        verifiedEvents.filter(
            event =>
                event.inputMatch
        ).length,

    inputAgreement,

    sinnerHealthChanges:
        sinnerHealthChanges.length,

    sinnerDepletions:
        sinnerDowns.length
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


// ============================================================
// SINNER OUTPUT
// ============================================================

writeFileSync(

    sinnerPath,

    JSON.stringify(
        {

            replay:
                replayName,

            note:
                'Sinner attribution is diagnostic. Strong candidates require both tight timing and close spatial proximity.',

            healthChanges:
                sinnerHealthMatches,

            depletions:
                sinnerDownMatches
        },
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
    'DIRECT MELEE VERIFICATION'
);
console.log(
    '===================================='
);
console.log('');

console.log(
    `Direct attacks: ${verifiedEvents.length}`
);

console.log(
    `Confirmed hits: ${
        verifiedEvents.filter(
            event =>
                event.hit
        ).length
    }`
);

console.log('');

console.log(
    'Attack types:'
);

for (
    const [
        type,
        count
    ]
    of Object.entries(
        byType
    )
) {

    console.log(
        `  ${type}: ${count}`
    );
}


console.log('');

console.log(
    `Sinner health decreases: ${sinnerHealthChanges.length}`
);

console.log(
    `Sinner depletions: ${sinnerDowns.length}`
);

console.log('');


for (
    const down
    of sinnerDownMatches
) {

    console.log(
        `Sinner ${down.sinnerEntityIndex} DOWN @ ${down.matchClock}`
    );


    if (
        down.bestCandidate
    ) {

        const candidate =
            down.bestCandidate;


        console.log(
            `  best candidate: ${candidate.playerName}` +
            ` ${candidate.attackType}` +
            ` hit=${candidate.hit}` +
            ` dt=${candidate.deltaSeconds.toFixed(3)}s` +
            (
                Number.isFinite(
                    candidate.distanceXY
                )
                    ? ` dist=${candidate.distanceXY.toFixed(1)}`
                    : ''
            )
        );

    } else {

        console.log(
            '  no nearby confirmed melee hit'
        );
    }
}


console.log('');
console.log(
    `Verified melee:\n${verifiedPath}`
);

console.log('');

console.log(
    `Summary:\n${summaryPath}`
);

console.log('');

console.log(
    `Sinner crosscheck:\n${sinnerPath}`
);

console.log('');


await parser.dispose();


// ============================================================
// MATCH USERCMD INPUT TO DIRECT ATTACK
// ============================================================

function matchInputsToDirectEvents(
    direct,
    inputs
) {

    const used =
        new Set();


    for (
        const attack
        of direct
    ) {

        if (
            !attack.playerName
        ) {
            continue;
        }


        let bestIndex =
            null;

        let bestDelta =
            Infinity;


        for (
            let i = 0;
            i < inputs.length;
            i++
        ) {

            if (
                used.has(i)
            ) {
                continue;
            }


            const input =
                inputs[i];


            if (
                input.playerName
                !==
                attack.playerName
            ) {
                continue;
            }


            const inputTime =
                firstFinite(

                    input
                        .estimatedActionMatchTimeSeconds,

                    input
                        .releaseMatchTimeSeconds,

                    input
                        .pressMatchTimeSeconds
                );


            if (
                !Number.isFinite(
                    inputTime
                )
            ) {
                continue;
            }


            const delta =
                Math.abs(
                    inputTime
                    -
                    attack
                        .firstObservedMatchTimeSeconds
                );


            if (
                delta <
                bestDelta
            ) {

                bestDelta =
                    delta;

                bestIndex =
                    i;
            }
        }


        if (
            bestIndex !== null
            &&
            bestDelta <= 1.0
        ) {

            used.add(
                bestIndex
            );


            const input =
                inputs[
                    bestIndex
                ];


            attack.inputMatch = {

                classification:
                    input.classification,

                holdSeconds:
                    input.holdSeconds,

                pressMatchTimeSeconds:
                    input.pressMatchTimeSeconds,

                releaseMatchTimeSeconds:
                    input.releaseMatchTimeSeconds,

                estimatedActionMatchTimeSeconds:
                    input
                        .estimatedActionMatchTimeSeconds,

                absoluteDeltaSeconds:
                    bestDelta
            };
        }
    }
}


// ============================================================
// SINNER CROSSCHECK
// ============================================================

function crosscheckSinnerEvent(
    sinnerEvent,
    meleeEvents
) {

    const candidates =
        [];


    for (
        const attack
        of meleeEvents
    ) {

        if (
            attack.hit !==
            true
        ) {
            continue;
        }


        const hitTime =
            attack
                .hitObservedMatchTimeSeconds;


        if (
            !Number.isFinite(
                hitTime
            )
        ) {
            continue;
        }


        const delta =
            hitTime
            -
            sinnerEvent
                .matchTimeSeconds;


        if (
            Math.abs(delta) >
            1.5
        ) {
            continue;
        }


        const distance =
            distanceXY(

                attack.hitPosition,

                sinnerEvent.position
            );


        candidates.push({

            playerName:
                attack.playerName,

            heroId:
                attack.heroId,

            team:
                attack.team,

            attackType:
                attack.attackType,

            attackTypeCode:
                attack.attackTypeCode,

            hit:
                attack.hit,

            hitMatchTimeSeconds:
                hitTime,

            hitClock:
                attack
                    .hitObservedClock,

            deltaSeconds:
                delta,

            distanceXY:
                distance,

            inputClassification:
                attack
                    .inputMatch
                    ?.classification
                ?? null,

            inputHoldSeconds:
                attack
                    .inputMatch
                    ?.holdSeconds
                ?? null,

            strongCandidate:
                Math.abs(
                    delta
                ) <=
                    0.5
                &&
                Number.isFinite(
                    distance
                )
                &&
                distance <=
                    800
        });
    }


    candidates.sort(
        (
            a,
            b
        ) => {

            const timeDifference =
                Math.abs(
                    a.deltaSeconds
                )
                -
                Math.abs(
                    b.deltaSeconds
                );


            if (
                Math.abs(
                    timeDifference
                ) >
                0.001
            ) {

                return timeDifference;
            }


            return (
                (
                    a.distanceXY
                    ??
                    Infinity
                )
                -
                (
                    b.distanceXY
                    ??
                    Infinity
                )
            );
        }
    );


    const strong =
        candidates.filter(
            candidate =>
                candidate
                    .strongCandidate
        );


    return {

        ...sinnerEvent,

        candidateCount:
            candidates.length,

        strongCandidateCount:
            strong.length,

        bestCandidate:
            strong[0]
            ??
            candidates[0]
            ??
            null,

        candidates
    };
}


// ============================================================
// OWNER RESOLUTION
// ============================================================

function resolveMeleeOwner(
    demo,
    ability
) {

    const ownerHandle =
        firstFinite(

            numberField(
                ability,
                'm_hOwnerEntity'
            ),

            numberField(
                ability,
                'CBodyComponent.m_hParent'
            )
        );


    let pawn =
        null;

    let controller =
        null;


    if (
        Number.isFinite(
            ownerHandle
        )
    ) {

        const owner =
            demo.getEntityByHandle(
                ownerHandle
            );


        const ownerClass =
            owner?.class?.name;


        if (
            ownerClass ===
            'CCitadelPlayerPawn'
        ) {

            pawn =
                owner;

        } else if (
            ownerClass ===
            'CCitadelPlayerController'
        ) {

            controller =
                owner;


            const pawnHandle =
                firstFinite(

                    numberField(
                        controller,
                        'm_hPawn'
                    ),

                    numberField(
                        controller,
                        'm_hHeroPawn'
                    )
                );


            if (
                Number.isFinite(
                    pawnHandle
                )
            ) {

                pawn =
                    demo.getEntityByHandle(
                        pawnHandle
                    );
            }
        }
    }


    if (
        pawn
        &&
        !controller
    ) {

        const controllerHandle =
            firstFinite(

                numberField(
                    pawn,
                    'm_hController'
                ),

                numberField(
                    pawn,
                    'm_hDefaultController'
                )
            );


        if (
            Number.isFinite(
                controllerHandle
            )
        ) {

            controller =
                demo.getEntityByHandle(
                    controllerHandle
                );
        }
    }


    return {

        ownerHandle,

        pawn,

        controller,

        playerName:
            controller
                ?.getField(
                    'm_iszPlayerName'
                )
            ??
            null,

        heroId:
            numberField(
                pawn,
                'm_nHeroID'
            )
            ??
            numberField(
                controller,
                'm_nHeroID'
            ),

        team:
            numberField(
                controller,
                'm_iTeamNum'
            )
            ??
            numberField(
                pawn,
                'm_iTeamNum'
            )
    };
}


// ============================================================
// WORLD POSITION
// ============================================================

function worldPosition(
    entity
) {

    if (!entity) {
        return null;
    }


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
// SUMMARY HELPERS
// ============================================================

function buildInputAgreement(
    events
) {

    const result = {};


    for (
        const event
        of events
    ) {

        if (
            !event.inputMatch
        ) {
            continue;
        }


        const direct =
            event.attackType;


        const input =
            event
                .inputMatch
                .classification;


        result[direct] ??=
            {};


        result[direct][input] =
            (
                result[direct][input]
                ??
                0
            )
            +
            1;
    }


    return result;
}


function countBy(
    values,
    getKey
) {

    const result =
        {};


    for (
        const value
        of values
    ) {

        const key =
            getKey(
                value
            );


        result[key] =
            (
                result[key]
                ??
                0
            )
            +
            1;
    }


    return result;
}


// ============================================================
// FIELD HELPERS
// ============================================================

function numberField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    const value =
        entity.getField(
            field
        );


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


function booleanField(
    entity,
    field
) {

    if (!entity) {
        return null;
    }


    const value =
        entity.getField(
            field
        );


    if (
        value === true
        ||
        value === false
    ) {

        return value;
    }


    return null;
}


function firstFinite(
    ...values
) {

    for (
        const value
        of values
    ) {

        if (
            Number.isFinite(
                value
            )
        ) {

            return value;
        }
    }


    return null;
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

        return null;
    }


    return Math.hypot(

        a.x - b.x,

        a.y - b.y
    );
}


// ============================================================
// FILE
// ============================================================

function readJsonl(
    path
) {

    return readFileSync(
        path,
        'utf8'
    )
        .split(
            /\r?\n/
        )
        .filter(
            Boolean
        )
        .map(
            line =>
                JSON.parse(
                    line
                )
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
    MATCH_OFFSET;
}


function formatClock(
    seconds
) {

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