import {
    createHash
} from 'node:crypto';

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';

import {
    tmpdir
} from 'node:os';

import {
    basename,
    dirname,
    join,
    resolve
} from 'node:path';

import {
    spawnSync
} from 'node:child_process';


// ============================================================
// VERSION
// ============================================================

const VERSION =
    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V01';


// ============================================================
// PURPOSE
//
// Freeze the installed-build RESOURCE CONTRACT for:
//
//   1. Permanent stat pickups
//   2. Bridge Powerups
//
// This follows:
//
//   Script133
//     explicit record discovery
//
//   Script134
//     permanent effects + source trace
//
//   Script135
//     bridge modifier-layout diagnostic
//
// Script135 established that bridge Powerups use:
//
//   m_vecModifierValues
//     m_eModifierValue
//     m_valueMin
//     m_valueMax
//
// rather than:
//
//   m_vecScriptValues
//     m_value
//
// This script reparses the LOCAL installed misc.vdata directly
// and writes one compact authoritative checkpoint.
//
// IMPORTANT SEMANTIC BOUNDARY:
//
// This contract establishes resource-defined effects.
//
// It does NOT establish:
//
//   - which player acquired an effect in a replay
//   - when acquisition occurred
//   - current stack counts
//   - stacking order with items / hero effects
//   - exact interpolation function between bridge min/max
//   - replay observability
//
// No replay parsing.
// No effective PlayerState(t).
//
// ONE JSON OUTPUT.
// NO MARKDOWN.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const SOURCE2VIEWER_PATH =
    resolve(
        'tools',
        'source2viewer',
        'Source2Viewer-CLI.exe'
    );


const RESOURCE_PATH =
    'scripts/misc.vdata_c';


const OUTPUT_JSON_PATH =
    resolve(
        'output',
        'cross_replay',
        'world_stat_buff_resource_contract_v01.json'
    );


// ============================================================
// PERMANENT PICKUP FAMILIES
// ============================================================

const PERMANENT_FAMILIES =
    [
        'spirit_permanent_pickup',
        'firerate_permanent_pickup',
        'ammo_permanent_pickup',
        'hp_permanent_pickup',
        'cd_permanent_pickup',
        'wp_permanent_pickup'
    ];


const PERMANENT_RECORDS =
    PERMANENT_FAMILIES.flatMap(
        family => [
            family,
            `${family}_lv2`,
            `${family}_lv3`
        ]
    );


// ============================================================
// BRIDGE POWERUPS
// ============================================================

const BRIDGE_RECORDS =
    [
        'gun_powerup_pickup',
        'survival_powerup_pickup',
        'casting_powerup_pickup',
        'movement_powerup_pickup'
    ];


// ============================================================
// OTHER SOURCE CHECKS
// ============================================================

const LION_STATUE_RECORD =
    'citadel_breakable_lion_statue';


// ============================================================
// DEADLOCK INSTALL CANDIDATES
// ============================================================

const installCandidates =
    [
        process.env.DEADLOCK_CITADEL_DIR
            ? resolve(
                process.env.DEADLOCK_CITADEL_DIR,
                'pak01_dir.vpk'
            )
            : null,

        'G:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'C:\\Program Files\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'D:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'E:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'F:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk'
    ]
        .filter(
            Boolean
        );


// ============================================================
// GUARDS
// ============================================================

if (
    !existsSync(
        SOURCE2VIEWER_PATH
    )
) {

    throw new Error(
        `Source2Viewer CLI not found:\n${SOURCE2VIEWER_PATH}`
    );
}


const pakPath =
    installCandidates.find(
        path =>
            existsSync(
                path
            )
    )
    ??
    null;


if (
    !pakPath
) {

    throw new Error(
        [
            'Could not locate Deadlock pak01_dir.vpk.',
            '',
            ...installCandidates.map(
                path =>
                    `  ${path}`
            )
        ].join(
            '\n'
        )
    );
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
    '========================================================'
);

console.log(
    'WORLD STAT BUFF RESOURCE CONTRACT V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    `Deadlock VPK:    ${pakPath}`
);

console.log(
    `Resource:        ${RESOURCE_PATH}`
);

console.log(
    'Replay parsing:  NONE'
);

console.log(
    'Output:          ONE COMPACT JSON'
);

console.log('');


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-world-buff-contract-'
        )
    );


try {

    const extraction =
        extractSingleResource({
            source2ViewerPath:
                SOURCE2VIEWER_PATH,

            pakPath,

            resourcePath:
                RESOURCE_PATH,

            temporaryDirectory
        });


    if (
        !extraction.success
    ) {

        throw new Error(
            `Failed to extract ${RESOURCE_PATH}`
        );
    }


    const resourceBuffer =
        readFileSync(
            extraction.localPath
        );


    const resourceText =
        resourceBuffer.toString(
            'utf8'
        );


    const resourceSha256 =
        createHash(
            'sha256'
        )
            .update(
                resourceBuffer
            )
            .digest(
                'hex'
            );


    const root =
        extractKv3Root(
            resourceText
        );


    if (
        !root
    ) {

        throw new Error(
            'Could not locate KV3 root.'
        );
    }


    const recordMap =
        new Map();


    for (
        const entry
        of parseTopLevelEntries(
            root.inner
        )
    ) {

        if (
            entry.type !==
            'object'
        ) {

            continue;
        }


        recordMap.set(
            entry.key,
            entry.inner
        );
    }


    console.log(
        `Top-level object records: ${recordMap.size}`
    );

    console.log(
        `Resource bytes:           ${resourceBuffer.length}`
    );

    console.log(
        `Resource SHA256:          ${resourceSha256}`
    );

    console.log('');


    // ========================================================
    // PERMANENT PICKUP CONTRACT
    // ========================================================

    const permanentEffects =
        [];


    for (
        const family
        of PERMANENT_FAMILIES
    ) {

        for (
            const tier
            of [
                1,
                2,
                3
            ]
        ) {

            const recordKey =
                tier ===
                1
                    ? family
                    : `${family}_lv${tier}`;


            const recordText =
                recordMap.get(
                    recordKey
                )
                ??
                null;


            if (
                !recordText
            ) {

                permanentEffects.push(
                    {
                        family,
                        tier,
                        recordKey,
                        found:
                            false
                    }
                );

                continue;
            }


            const modifierBlock =
                extractNamedObjectField(
                    recordText,
                    'm_sModifer'
                )
                ??
                extractNamedObjectField(
                    recordText,
                    'm_sModifier'
                );


            if (
                !modifierBlock
            ) {

                permanentEffects.push(
                    {
                        family,
                        tier,
                        recordKey,
                        found:
                            true,

                        modifierParsed:
                            false
                    }
                );

                continue;
            }


            const modifierFlat =
                parseFlatScalarMap(
                    modifierBlock.inner
                );


            permanentEffects.push(
                {
                    family,

                    tier,

                    recordKey,

                    found:
                        true,

                    modifierParsed:
                        true,

                    isPermanentPickup:
                        captureScalarField(
                            recordText,
                            'm_bIsPermanentPickup'
                        ),

                    baseRecord:
                        captureScalarField(
                            recordText,
                            '_base'
                        ),

                    modifierClass:
                        modifierFlat._class
                        ??
                        modifierFlat._my_subclass_name
                        ??
                        null,

                    modifierValue:
                        modifierFlat.m_eModifierValue
                        ??
                        null,

                    value:
                        finiteOrScalar(
                            modifierFlat.m_value
                        )
                }
            );
        }
    }


    // ========================================================
    // PERMANENT FAMILY TABLE
    // ========================================================

    const permanentFamilyTables =
        PERMANENT_FAMILIES.map(
            family => ({
                family,

                tiers:
                    permanentEffects
                        .filter(
                            row =>
                                row.family ===
                                family
                        )
                        .sort(
                            (
                                a,
                                b
                            ) =>
                                a.tier -
                                b.tier
                        )
                        .map(
                            row => ({
                                tier:
                                    row.tier,

                                recordKey:
                                    row.recordKey,

                                modifierValue:
                                    row.modifierValue
                                    ??
                                    null,

                                value:
                                    row.value
                                    ??
                                    null,

                                permanent:
                                    row.isPermanentPickup
                                    ??
                                    null
                            })
                        )
            })
        );


    // ========================================================
    // BRIDGE POWERUP CONTRACT
    // ========================================================

    const bridgeEffects =
        [];


    for (
        const recordKey
        of BRIDGE_RECORDS
    ) {

        const recordText =
            recordMap.get(
                recordKey
            )
            ??
            null;


        if (
            !recordText
        ) {

            bridgeEffects.push(
                {
                    recordKey,

                    found:
                        false
                }
            );

            continue;
        }


        const modifierBlock =
            extractNamedObjectField(
                recordText,
                'm_sModifer'
            )
            ??
            extractNamedObjectField(
                recordText,
                'm_sModifier'
            );


        if (
            !modifierBlock
        ) {

            bridgeEffects.push(
                {
                    recordKey,

                    found:
                        true,

                    modifierParsed:
                        false
                }
            );

            continue;
        }


        const modifierFlat =
            parseFlatScalarMap(
                modifierBlock.inner
            );


        const modifierValues =
            parseBridgeModifierValues(
                modifierBlock.inner
            );


        const alwaysShowUi =
            parseQuotedArrayField(
                modifierBlock.inner,
                'm_vecAlwaysShowInStatModifierUI'
            );


        bridgeEffects.push(
            {
                recordKey,

                found:
                    true,

                modifierParsed:
                    true,

                modifierClass:
                    modifierFlat._class
                    ??
                    modifierFlat._my_subclass_name
                    ??
                    null,

                durationSeconds:
                    finite(
                        modifierFlat.m_flDuration
                    ),

                timeMinMinutes:
                    finite(
                        modifierFlat.m_flTimeMin
                    ),

                timeMaxMinutes:
                    finite(
                        modifierFlat.m_flTimeMax
                    ),

                modifierValues,

                uiDisplayTokens:
                    alwaysShowUi,

                uiDisplayTokensAreMechanicAuthority:
                    false,

                timeScalingInterpretation:
                    'MIN_MAX_TIME_SCALED_RESOURCE_STRUCTURE',

                interpolationFunctionValidated:
                    false
            }
        );
    }


    // ========================================================
    // PERMANENT PICKUP SOURCE REFERENCES
    // ========================================================

    const producerMap =
        new Map();


    for (
        const [
            recordKey,
            recordText
        ]
        of recordMap.entries()
    ) {

        if (
            PERMANENT_RECORDS.includes(
                recordKey
            )
        ) {

            continue;
        }


        const referenced =
            PERMANENT_RECORDS.filter(
                target =>
                    containsExactIdentifier(
                        recordText,
                        target
                    )
            );


        if (
            referenced.length ===
            0
        ) {

            continue;
        }


        producerMap.set(
            recordKey,
            referenced
        );
    }


    const permanentProducerCandidates =
        [
            ...producerMap.entries()
        ]
            .map(
                ([
                    recordKey,
                    referencedPickups
                ]) => ({
                    recordKey,

                    referencedPickups:
                        referencedPickups.sort(),

                    referenceCount:
                        referencedPickups.length
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.referenceCount -
                    a.referenceCount
                    ||
                    a.recordKey.localeCompare(
                        b.recordKey
                    )
            );


    // ========================================================
    // LION STATUE CHECK
    // ========================================================

    const lionStatueText =
        recordMap.get(
            LION_STATUE_RECORD
        )
        ??
        null;


    const lionStatueInspection =
        lionStatueText
            ? {
                found:
                    true,

                directPermanentPickupReferences:
                    PERMANENT_RECORDS.filter(
                        target =>
                            containsExactIdentifier(
                                lionStatueText,
                                target
                            )
                    ),

                smallGoldPickupReferenced:
                    containsExactIdentifier(
                        lionStatueText,
                        'small_gold_pickup'
                    )
            }
            : {
                found:
                    false
            };


    // ========================================================
    // VALIDATION
    // ========================================================

    const expectedBridgeEffectCounts =
        {
            gun_powerup_pickup:
                2,

            survival_powerup_pickup:
                2,

            casting_powerup_pickup:
                2,

            movement_powerup_pickup:
                4
        };


    const validationChecks =
        {
            allPermanentRecordsFound:
                check(
                    permanentEffects.filter(
                        row =>
                            row.found
                    ).length,

                    18,

                    permanentEffects.every(
                        row =>
                            row.found
                    )
                ),


            allPermanentModifiersParsed:
                check(
                    permanentEffects.filter(
                        row =>
                            row.modifierParsed
                    ).length,

                    18,

                    permanentEffects.every(
                        row =>
                            row.modifierParsed
                    )
                ),


            allPermanentFlagsTrue:
                check(
                    permanentEffects.filter(
                        row =>
                            row.isPermanentPickup ===
                            true
                    ).length,

                    18,

                    permanentEffects.every(
                        row =>
                            row.isPermanentPickup ===
                            true
                    )
                ),


            allBridgeRecordsFound:
                check(
                    bridgeEffects.filter(
                        row =>
                            row.found
                    ).length,

                    4,

                    bridgeEffects.every(
                        row =>
                            row.found
                    )
                ),


            allBridgeModifiersParsed:
                check(
                    bridgeEffects.filter(
                        row =>
                            row.modifierParsed
                    ).length,

                    4,

                    bridgeEffects.every(
                        row =>
                            row.modifierParsed
                    )
                ),


            allBridgeTimingFieldsParsed:
                check(
                    bridgeEffects.filter(
                        row =>
                            row.durationSeconds ===
                            160
                            &&
                            row.timeMinMinutes ===
                            5
                            &&
                            row.timeMaxMinutes ===
                            40
                    ).length,

                    4,

                    bridgeEffects.every(
                        row =>
                            row.durationSeconds ===
                            160
                            &&
                            row.timeMinMinutes ===
                            5
                            &&
                            row.timeMaxMinutes ===
                            40
                    )
                ),


            bridgeEffectCountsMatch:
                check(
                    bridgeEffects.filter(
                        row =>
                            (
                                row.modifierValues
                                ??
                                []
                            ).length ===
                            expectedBridgeEffectCounts[
                                row.recordKey
                            ]
                    ).length,

                    4,

                    bridgeEffects.every(
                        row =>
                            (
                                row.modifierValues
                                ??
                                []
                            ).length ===
                            expectedBridgeEffectCounts[
                                row.recordKey
                            ]
                    )
                )
        };


    const validationPass =
        Object
            .values(
                validationChecks
            )
            .every(
                row =>
                    row.pass
            );


    const status =
        validationPass
            ? 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V01_READY'
            : 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V01_REQUIRES_DIAGNOSIS';


    const nextStage =
        validationPass
            ? 'BUILD_CURRENT_PURCHASABLE_ITEM_STAT_CATALOG'
            : 'DIAGNOSE_ONLY_FAILED_WORLD_BUFF_CONTRACT_FIELDS';


    // ========================================================
    // OUTPUT OBJECT
    // ========================================================

    const output =
        {
            version:
                VERSION,

            canonical:
                false,

            versionBoundToInstalledBuild:
                true,

            createdAt:
                new Date().toISOString(),

            status,

            source:
                {
                    method:
                        'LOCAL_INSTALLED_MISC_VDATA',

                    pakPath,

                    resourcePath:
                        RESOURCE_PATH,

                    resourceBytes:
                        resourceBuffer.length,

                    resourceSha256
                },

            permanentPickups:
                {
                    recordCount:
                        permanentEffects.length,

                    effects:
                        permanentEffects,

                    familyTables:
                        permanentFamilyTables,

                    producerCandidates:
                        permanentProducerCandidates,

                    interpretation:
                        {
                            permanence:
                                'RESOURCE_VALIDATED',

                            exactEffectValues:
                                'RESOURCE_VALIDATED',

                            actualReplayAcquisition:
                                'UNRESOLVED',

                            stackCountAtTimeT:
                                'UNRESOLVED',

                            sourceWorldObject:
                                'PARTIALLY_RESOLVED_RESOURCE_GRAPH_ONLY'
                        }
                },

            bridgePowerups:
                {
                    recordCount:
                        bridgeEffects.length,

                    effects:
                        bridgeEffects,

                    sharedTiming:
                        {
                            durationSeconds:
                                160,

                            timeMinMinutes:
                                5,

                            timeMaxMinutes:
                                40
                        },

                    interpretation:
                        {
                            modifierEndpoints:
                                'RESOURCE_VALIDATED',

                            duration:
                                'RESOURCE_VALIDATED',

                            timeScaleBounds:
                                'RESOURCE_VALIDATED',

                            exactInterpolationFunction:
                                'UNRESOLVED',

                            actualReplayAcquisition:
                                'UNRESOLVED'
                        }
                },

            lionStatueInspection,

            guardrails:
                {
                    resourceEffectVsRuntimeState:
                        'A resource-defined modifier does not prove that a player had that modifier at a replay timestamp.',

                    bridgeInterpolation:
                        'm_valueMin/m_valueMax with m_flTimeMin/m_flTimeMax establishes time-scaled endpoints, but this checkpoint does not assume a particular interpolation function.',

                    uiDisplayList:
                        'm_vecAlwaysShowInStatModifierUI is presentation metadata and is not used as the mechanics authority.',

                    unitConversion:
                        'Raw modifier values are preserved exactly. Player-facing unit conversion is not performed unless separately validated.'
                },

            validation:
                {
                    pass:
                        validationPass,

                    checks:
                        validationChecks
                },

            nextStage,

            output:
                OUTPUT_JSON_PATH
        };


    // ========================================================
    // WRITE
    // ========================================================

    mkdirSync(
        dirname(
            OUTPUT_JSON_PATH
        ),
        {
            recursive:
                true
        }
    );


    writeFileSync(
        OUTPUT_JSON_PATH,
        JSON.stringify(
            output,
            null,
            2
        ),
        'utf8'
    );


    // ========================================================
    // CONSOLE: PERMANENT TABLE
    // ========================================================

    console.log(
        '========================================================'
    );

    console.log(
        'PERMANENT PICKUP RESOURCE CONTRACT'
    );

    console.log(
        '========================================================'
    );

    console.log('');


    for (
        const family
        of permanentFamilyTables
    ) {

        console.log(
            family.family
        );


        for (
            const row
            of family.tiers
        ) {

            console.log(
                `  tier=${row.tier} ` +
                `${String(row.modifierValue).padEnd(52)} ` +
                `value=${row.value} ` +
                `permanent=${row.permanent}`
            );
        }


        console.log('');
    }


    // ========================================================
    // CONSOLE: BRIDGE TABLE
    // ========================================================

    console.log(
        '========================================================'
    );

    console.log(
        'BRIDGE POWERUP RESOURCE CONTRACT'
    );

    console.log(
        '========================================================'
    );

    console.log('');


    for (
        const powerup
        of bridgeEffects
    ) {

        console.log(
            powerup.recordKey
        );


        console.log(
            `  modifierClass=${powerup.modifierClass}`
        );


        console.log(
            `  duration=${powerup.durationSeconds}s ` +
            `timeMin=${powerup.timeMinMinutes}m ` +
            `timeMax=${powerup.timeMaxMinutes}m`
        );


        for (
            const effect
            of powerup.modifierValues
            ??
            []
        ) {

            console.log(
                `  ${effect.modifierValue.padEnd(58)} ` +
                `min=${effect.valueMin} ` +
                `max=${effect.valueMax}`
            );
        }


        console.log(
            `  uiDisplayTokens=${JSON.stringify(powerup.uiDisplayTokens)}`
        );


        console.log('');
    }


    // ========================================================
    // PRODUCER CANDIDATES
    // ========================================================

    console.log(
        '========================================================'
    );

    console.log(
        'PERMANENT PICKUP PRODUCER CANDIDATES'
    );

    console.log(
        '========================================================'
    );

    console.log('');


    for (
        const row
        of permanentProducerCandidates
    ) {

        console.log(
            `${row.recordKey.padEnd(55)} ` +
            `refs=${row.referenceCount}`
        );
    }


    console.log('');

    console.log(
        'LION STATUE INSPECTION'
    );

    console.log(
        '----------------------'
    );

    console.log(
        JSON.stringify(
            lionStatueInspection,
            null,
            2
        )
    );

    console.log('');


    // ========================================================
    // VALIDATION
    // ========================================================

    console.log(
        'VALIDATION'
    );

    console.log(
        '----------'
    );


    for (
        const [
            name,
            row
        ]
        of Object.entries(
            validationChecks
        )
    ) {

        console.log(
            `${name.padEnd(42)} ${row.pass} ` +
            `actual=${JSON.stringify(row.actual)} ` +
            `expected=${JSON.stringify(row.expected)}`
        );
    }


    console.log('');

    console.log(
        'FINAL STATUS'
    );

    console.log(
        '------------'
    );

    console.log(
        status
    );

    console.log('');

    console.log(
        'NEXT STAGE'
    );

    console.log(
        '----------'
    );

    console.log(
        nextStage
    );

    console.log('');

    console.log(
        `JSON:\n${OUTPUT_JSON_PATH}`
    );

    console.log('');

} finally {

    rmSync(
        temporaryDirectory,
        {
            recursive:
                true,

            force:
                true
        }
    );
}


// ============================================================
// BRIDGE MODIFIER VALUE PARSER
// ============================================================

function parseBridgeModifierValues(
    modifierText
) {

    const arrayBlock =
        extractNamedArrayField(
            modifierText,
            'm_vecModifierValues'
        );


    if (
        !arrayBlock
    ) {

        return [];
    }


    const objects =
        extractObjectBodies(
            arrayBlock.inner
        );


    const rows =
        [];


    for (
        const objectText
        of objects
    ) {

        const flat =
            parseFlatScalarMap(
                objectText
            );


        const modifierValue =
            flat.m_eModifierValue
            ??
            null;


        const valueMin =
            finite(
                flat.m_valueMin
            );


        const valueMax =
            finite(
                flat.m_valueMax
            );


        if (
            modifierValue ===
            null
        ) {

            continue;
        }


        rows.push(
            {
                modifierValue:
                    String(
                        modifierValue
                    ),

                valueMin,

                valueMax
            }
        );
    }


    return rows;
}


// ============================================================
// QUOTED ARRAY FIELD
// ============================================================

function parseQuotedArrayField(
    text,
    fieldName
) {

    const array =
        extractNamedArrayField(
            text,
            fieldName
        );


    if (
        !array
    ) {

        return [];
    }


    return [
        ...array.inner.matchAll(
            /"([^"]+)"/g
        )
    ]
        .map(
            match =>
                match[
                    1
                ]
        );
}


// ============================================================
// NAMED OBJECT
// ============================================================

function extractNamedObjectField(
    text,
    fieldName
) {

    const match =
        new RegExp(
            `${escapeRegex(fieldName)}\\s*=\\s*(?:subclass:\\s*)?\\{`,
            'm'
        ).exec(
            text
        );


    if (
        !match
    ) {

        return null;
    }


    const open =
        text.indexOf(
            '{',
            match.index
        );


    if (
        open <
        0
    ) {

        return null;
    }


    const close =
        findMatchingDelimiter(
            text,
            open,
            '{',
            '}'
        );


    if (
        close ===
        null
    ) {

        return null;
    }


    return {
        inner:
            text.slice(
                open +
                1,
                close
            )
    };
}


// ============================================================
// NAMED ARRAY
// ============================================================

function extractNamedArrayField(
    text,
    fieldName
) {

    const match =
        new RegExp(
            `${escapeRegex(fieldName)}\\s*=\\s*\\[`,
            'm'
        ).exec(
            text
        );


    if (
        !match
    ) {

        return null;
    }


    const open =
        text.indexOf(
            '[',
            match.index
        );


    if (
        open <
        0
    ) {

        return null;
    }


    const close =
        findMatchingDelimiter(
            text,
            open,
            '[',
            ']'
        );


    if (
        close ===
        null
    ) {

        return null;
    }


    return {
        inner:
            text.slice(
                open +
                1,
                close
            )
    };
}


// ============================================================
// ARRAY OBJECT EXTRACTION
// ============================================================

function extractObjectBodies(
    text
) {

    const rows =
        [];


    let index =
        0;


    while (
        index <
        text.length
    ) {

        const open =
            findNextUnquotedCharacter(
                text,
                '{',
                index
            );


        if (
            open ===
            null
        ) {

            break;
        }


        const close =
            findMatchingDelimiter(
                text,
                open,
                '{',
                '}'
            );


        if (
            close ===
            null
        ) {

            break;
        }


        rows.push(
            text.slice(
                open +
                1,
                close
            )
        );


        index =
            close +
            1;
    }


    return rows;
}


// ============================================================
// SCALAR FIELD CAPTURE
// ============================================================

function captureScalarField(
    text,
    fieldName
) {

    const match =
        new RegExp(
            `^\\s*${escapeRegex(fieldName)}\\s*=\\s*(.+?)\\s*,?\\s*$`,
            'm'
        ).exec(
            text
        );


    if (
        !match
    ) {

        return null;
    }


    return parseScalar(
        match[
            1
        ]
    );
}


// ============================================================
// EXACT IDENTIFIER SEARCH
// ============================================================

function containsExactIdentifier(
    text,
    identifier
) {

    return new RegExp(
        `(?<![A-Za-z0-9_])${escapeRegex(identifier)}(?![A-Za-z0-9_])`
    ).test(
        text
    );
}


// ============================================================
// RESOURCE EXTRACTION
// ============================================================

function extractSingleResource({
    source2ViewerPath,
    pakPath,
    resourcePath,
    temporaryDirectory
}) {

    const safeName =
        resourcePath
            .replace(
                /[\\/:*?"<>|]/g,
                '_'
            )
            .replace(
                /_c$/,
                ''
            );


    const desiredOutput =
        join(
            temporaryDirectory,
            safeName
        );


    const result =
        spawnSync(
            source2ViewerPath,
            [
                '--input',
                pakPath,

                '--vpk_filepath',
                resourcePath,

                '--output',
                desiredOutput,

                '--vpk_decompile'
            ],
            {
                encoding:
                    'utf8',

                windowsHide:
                    true,

                maxBuffer:
                    128 *
                    1024 *
                    1024
            }
        );


    if (
        result.status !==
        0
    ) {

        return {
            success:
                false
        };
    }


    let localPath =
        existsSync(
            desiredOutput
        )
            ? desiredOutput
            : null;


    if (
        !localPath
    ) {

        localPath =
            findFileRecursive(
                temporaryDirectory,
                fileName =>
                    fileName
                        .toLowerCase()
                        .includes(
                            basename(
                                safeName
                            ).toLowerCase()
                        )
            );
    }


    if (
        !localPath
    ) {

        return {
            success:
                false
        };
    }


    return {
        success:
            true,

        localPath
    };
}


// ============================================================
// KV3 ROOT
// ============================================================

function extractKv3Root(
    text
) {

    const headerPresent =
        /<!--\s*kv3/i.test(
            text
        );


    const headerEnd =
        text.indexOf(
            '-->'
        );


    const searchStart =
        (
            headerPresent
            &&
            headerEnd >=
            0
        )
            ? headerEnd +
                3
            : 0;


    const rootStart =
        findNextUnquotedCharacter(
            text,
            '{',
            searchStart
        );


    if (
        rootStart ===
        null
    ) {

        return null;
    }


    const rootEnd =
        findMatchingDelimiter(
            text,
            rootStart,
            '{',
            '}'
        );


    if (
        rootEnd ===
        null
    ) {

        return null;
    }


    return {
        inner:
            text.slice(
                rootStart +
                1,
                rootEnd
            )
    };
}


// ============================================================
// TOP-LEVEL PARSER
// ============================================================

function parseTopLevelEntries(
    text
) {

    const rows =
        [];


    let index =
        0;


    while (
        index <
        text.length
    ) {

        index =
            skipWhitespaceAndComments(
                text,
                index
            );


        if (
            index >=
            text.length
        ) {

            break;
        }


        const key =
            readKey(
                text,
                index
            );


        if (
            !key
        ) {

            index++;

            continue;
        }


        index =
            skipWhitespaceAndComments(
                text,
                key.end
            );


        if (
            text[
                index
            ] !==
            '='
        ) {

            index++;

            continue;
        }


        index++;


        index =
            skipWhitespaceAndComments(
                text,
                index
            );


        const first =
            text[
                index
            ];


        if (
            first ===
            '{'
        ) {

            const close =
                findMatchingDelimiter(
                    text,
                    index,
                    '{',
                    '}'
                );


            if (
                close ===
                null
            ) {

                break;
            }


            rows.push(
                {
                    key:
                        key.key,

                    type:
                        'object',

                    inner:
                        text.slice(
                            index +
                            1,
                            close
                        )
                }
            );


            index =
                close +
                1;

            continue;
        }


        if (
            first ===
            '['
        ) {

            const close =
                findMatchingDelimiter(
                    text,
                    index,
                    '[',
                    ']'
                );


            if (
                close ===
                null
            ) {

                break;
            }


            rows.push(
                {
                    key:
                        key.key,

                    type:
                        'array',

                    inner:
                        text.slice(
                            index +
                            1,
                            close
                        )
                }
            );


            index =
                close +
                1;

            continue;
        }


        const scalar =
            readScalarUntilLineEnd(
                text,
                index
            );


        rows.push(
            {
                key:
                    key.key,

                type:
                    'scalar',

                rawValue:
                    scalar.value
            }
        );


        index =
            scalar.end;
    }


    return rows;
}


// ============================================================
// FLAT SCALAR MAP
// ============================================================

function parseFlatScalarMap(
    text
) {

    const output =
        {};


    for (
        const row
        of parseTopLevelEntries(
            text
        )
    ) {

        if (
            row.type !==
            'scalar'
        ) {

            continue;
        }


        output[
            row.key
        ] =
            parseScalar(
                row.rawValue
            );
    }


    return output;
}


// ============================================================
// DELIMITER MATCHING
// ============================================================

function findMatchingDelimiter(
    text,
    openIndex,
    openChar,
    closeChar
) {

    let depth =
        0;


    let inQuote =
        false;


    let escaped =
        false;


    for (
        let index =
            openIndex;

        index <
            text.length;

        index++
    ) {

        const char =
            text[
                index
            ];


        if (
            inQuote
        ) {

            if (
                escaped
            ) {

                escaped =
                    false;

                continue;
            }


            if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

                continue;
            }


            if (
                char ===
                '"'
            ) {

                inQuote =
                    false;
            }


            continue;
        }


        if (
            char ===
            '"'
        ) {

            inQuote =
                true;

            continue;
        }


        if (
            char ===
            openChar
        ) {

            depth++;

        } else if (
            char ===
            closeChar
        ) {

            depth--;


            if (
                depth ===
                0
            ) {

                return index;
            }
        }
    }


    return null;
}


// ============================================================
// FIND UNQUOTED CHARACTER
// ============================================================

function findNextUnquotedCharacter(
    text,
    target,
    start
) {

    let inQuote =
        false;


    let escaped =
        false;


    for (
        let index =
            start;

        index <
            text.length;

        index++
    ) {

        const char =
            text[
                index
            ];


        if (
            inQuote
        ) {

            if (
                escaped
            ) {

                escaped =
                    false;

                continue;
            }


            if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

                continue;
            }


            if (
                char ===
                '"'
            ) {

                inQuote =
                    false;
            }


            continue;
        }


        if (
            char ===
            '"'
        ) {

            inQuote =
                true;

            continue;
        }


        if (
            char ===
            target
        ) {

            return index;
        }
    }


    return null;
}


// ============================================================
// WHITESPACE
// ============================================================

function skipWhitespaceAndComments(
    text,
    start
) {

    let index =
        start;


    while (
        index <
        text.length
    ) {

        if (
            /\s/.test(
                text[
                    index
                ]
            )
        ) {

            index++;

            continue;
        }


        if (
            text[
                index
            ] ===
            '/'
            &&
            text[
                index +
                1
            ] ===
            '/'
        ) {

            const newline =
                text.indexOf(
                    '\n',
                    index +
                    2
                );


            if (
                newline <
                0
            ) {

                return text.length;
            }


            index =
                newline +
                1;

            continue;
        }


        break;
    }


    return index;
}


// ============================================================
// KEY
// ============================================================

function readKey(
    text,
    start
) {

    if (
        text[
            start
        ] ===
        '"'
    ) {

        let index =
            start +
            1;


        let value =
            '';


        let escaped =
            false;


        while (
            index <
            text.length
        ) {

            const char =
                text[
                    index
                ];


            if (
                escaped
            ) {

                value +=
                    char;

                escaped =
                    false;

                index++;

                continue;
            }


            if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

                index++;

                continue;
            }


            if (
                char ===
                '"'
            ) {

                return {
                    key:
                        value,

                    end:
                        index +
                        1
                };
            }


            value +=
                char;

            index++;
        }


        return null;
    }


    const match =
        text
            .slice(
                start
            )
            .match(
                /^([A-Za-z0-9_:.\/\-]+)/
            );


    if (
        !match
    ) {

        return null;
    }


    return {
        key:
            match[
                1
            ],

        end:
            start +
            match[
                1
            ].length
    };
}


// ============================================================
// SCALAR READER
// ============================================================

function readScalarUntilLineEnd(
    text,
    start
) {

    let index =
        start;


    let inQuote =
        false;


    let escaped =
        false;


    while (
        index <
        text.length
    ) {

        const char =
            text[
                index
            ];


        if (
            inQuote
        ) {

            if (
                escaped
            ) {

                escaped =
                    false;

            } else if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

            } else if (
                char ===
                '"'
            ) {

                inQuote =
                    false;
            }


            index++;

            continue;
        }


        if (
            char ===
            '"'
        ) {

            inQuote =
                true;

            index++;

            continue;
        }


        if (
            char ===
            '\n'
            ||
            char ===
            '\r'
        ) {

            break;
        }


        index++;
    }


    return {
        value:
            text
                .slice(
                    start,
                    index
                )
                .trim()
                .replace(
                    /,$/,
                    ''
                )
                .trim(),

        end:
            index +
            1
    };
}


// ============================================================
// SCALAR PARSER
// ============================================================

function parseScalar(
    raw
) {

    if (
        raw ===
        null
        ||
        raw ===
        undefined
    ) {

        return null;
    }


    const value =
        String(
            raw
        )
            .trim()
            .replace(
                /,$/,
                ''
            )
            .trim();


    if (
        value ===
        ''
    ) {

        return null;
    }


    if (
        value ===
        'true'
    ) {

        return true;
    }


    if (
        value ===
        'false'
    ) {

        return false;
    }


    if (
        /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(
            value
        )
    ) {

        return Number(
            value
        );
    }


    const quoted =
        value.match(
            /^"(.*)"$/
        );


    if (
        quoted
    ) {

        return quoted[
            1
        ];
    }


    return value;
}


// ============================================================
// NUMERIC
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


function finiteOrScalar(
    value
) {

    const number =
        finite(
            value
        );


    return number !==
        null
        ? number
        : value;
}


// ============================================================
// VALIDATION CHECK
// ============================================================

function check(
    actual,
    expected,
    pass
) {

    return {
        actual,
        expected,

        pass:
            Boolean(
                pass
            )
    };
}


// ============================================================
// REGEX ESCAPE
// ============================================================

function escapeRegex(
    value
) {

    return String(
        value
    ).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );
}


// ============================================================
// FILE FIND
// ============================================================

function findFileRecursive(
    directory,
    predicate
) {

    if (
        !existsSync(
            directory
        )
    ) {

        return null;
    }


    for (
        const entry
        of readdirSync(
            directory,
            {
                withFileTypes:
                    true
            }
        )
    ) {

        const path =
            join(
                directory,
                entry.name
            );


        if (
            entry.isDirectory()
        ) {

            const nested =
                findFileRecursive(
                    path,
                    predicate
                );


            if (
                nested
            ) {

                return nested;
            }


            continue;
        }


        if (
            predicate(
                entry.name,
                path
            )
        ) {

            return path;
        }
    }


    return null;
}