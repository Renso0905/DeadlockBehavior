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
    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02';


// ============================================================
// PURPOSE
//
// Script136 V01 is SUPERSEDED.
//
// V01 correctly froze the bridge Powerup contract but failed to
// preserve permanent pickup modifier values because permanent
// effects live inside:
//
//   m_vecScriptValues
//
// while V01 parsed only top-level scalar fields.
//
// V01 validation also failed to require non-null permanent
// modifier tokens and values, allowing a false-positive PASS.
//
// V02 explicitly parses:
//
// PERMANENT PICKUPS
//
//   m_sModifer
//     m_vecScriptValues
//       m_eModifierValue
//       m_value
//
// BRIDGE POWERUPS
//
//   m_sModifer
//     m_vecModifierValues
//       m_eModifierValue
//       m_valueMin
//       m_valueMax
//
// V02 then validates the exact installed-build contract already
// discovered by Scripts133-135.
//
// This is intentionally VERSION BOUND.
//
// If Valve changes these values in a future local build,
// validation should fail.
//
// No replay parsing.
// No PlayerState(t) calculation.
//
// ONE JSON OUTPUT.
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
        'world_stat_buff_resource_contract_v02.json'
    );


// ============================================================
// EXPECTED PERMANENT CONTRACT
//
// These values were independently discovered from the installed
// resource in Scripts133 / 134.
//
// This validator intentionally fails if the local build changes.
// ============================================================

const EXPECTED_PERMANENT =
    {
        spirit_permanent_pickup:
            {
                modifierValue:
                    'MODIFIER_VALUE_TECH_POWER',

                values:
                    [
                        2,
                        3,
                        4
                    ]
            },

        firerate_permanent_pickup:
            {
                modifierValue:
                    'MODIFIER_VALUE_FIRE_RATE',

                values:
                    [
                        1.5,
                        2,
                        2.5
                    ]
            },

        ammo_permanent_pickup:
            {
                modifierValue:
                    'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',

                values:
                    [
                        3,
                        5,
                        7
                    ]
            },

        hp_permanent_pickup:
            {
                modifierValue:
                    'MODIFIER_VALUE_HEALTH_MAX',

                values:
                    [
                        15,
                        20,
                        30
                    ]
            },

        cd_permanent_pickup:
            {
                modifierValue:
                    'MODIFIER_VALUE_COOLDOWN_REDUCTION_PERCENTAGE',

                values:
                    [
                        0.5,
                        0.75,
                        1
                    ]
            },

        wp_permanent_pickup:
            {
                modifierValue:
                    'MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE',

                values:
                    [
                        3,
                        4,
                        6
                    ]
            }
    };


// ============================================================
// EXPECTED BRIDGE CONTRACT
// ============================================================

const EXPECTED_BRIDGE =
    {
        gun_powerup_pickup:
            {
                modifierClass:
                    'modifier_citadel_powerup_gun',

                durationSeconds:
                    160,

                timeMinMinutes:
                    5,

                timeMaxMinutes:
                    40,

                effects:
                    [
                        {
                            modifierValue:
                                'MODIFIER_VALUE_FIRE_RATE',

                            valueMin:
                                12,

                            valueMax:
                                35
                        },
                        {
                            modifierValue:
                                'MODIFIER_VALUE_AMMO_CLIP_SIZE_PERCENT',

                            valueMin:
                                35,

                            valueMax:
                                70
                        }
                    ]
            },

        survival_powerup_pickup:
            {
                modifierClass:
                    'modifier_citadel_powerup_survival',

                durationSeconds:
                    160,

                timeMinMinutes:
                    5,

                timeMaxMinutes:
                    40,

                effects:
                    [
                        {
                            modifierValue:
                                'MODIFIER_VALUE_HEALTH_MAX',

                            valueMin:
                                200,

                            valueMax:
                                750
                        },
                        {
                            modifierValue:
                                'MODIFIER_VALUE_HEALTH_REGEN_PER_SECOND',

                            valueMin:
                                4,

                            valueMax:
                                40
                        }
                    ]
            },

        casting_powerup_pickup:
            {
                modifierClass:
                    'modifier_citadel_powerup_casting',

                durationSeconds:
                    160,

                timeMinMinutes:
                    5,

                timeMaxMinutes:
                    40,

                effects:
                    [
                        {
                            modifierValue:
                                'MODIFIER_VALUE_TECH_POWER',

                            valueMin:
                                15,

                            valueMax:
                                65
                        },
                        {
                            modifierValue:
                                'MODIFIER_VALUE_COOLDOWN_REDUCTION_PERCENTAGE',

                            valueMin:
                                12,

                            valueMax:
                                20
                        }
                    ]
            },

        movement_powerup_pickup:
            {
                modifierClass:
                    'modifier_citadel_powerup_movement',

                durationSeconds:
                    160,

                timeMinMinutes:
                    5,

                timeMaxMinutes:
                    40,

                effects:
                    [
                        {
                            modifierValue:
                                'MODIFIER_VALUE_STAMINA',

                            valueMin:
                                2,

                            valueMax:
                                4
                        },
                        {
                            modifierValue:
                                'MODIFIER_VALUE_SPRINT_SPEED_BONUS',

                            valueMin:
                                59.0551,

                            valueMax:
                                157.48
                        },
                        {
                            modifierValue:
                                'MODIFIER_VALUE_ZIP_LINE_SPEED_PERCENTAGE',

                            valueMin:
                                40,

                            valueMax:
                                80
                        },
                        {
                            modifierValue:
                                'MODIFIER_VALUE_STAMINA_REGEN_PER_SECOND_PERCENTAGE',

                            valueMin:
                                20,

                            valueMax:
                                50
                        }
                    ]
            }
    };


// ============================================================
// OTHER RESOURCE CHECKS
// ============================================================

const PRODUCER_CANDIDATE_KEYS =
    [
        'citadel_breakable_item_container',
        'citadel_breakable_prop_drop_powerups'
    ];


const LION_STATUE_RECORD =
    'citadel_breakable_lion_statue';


// ============================================================
// INSTALL CANDIDATES
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
    'WORLD STAT BUFF RESOURCE CONTRACT V0.2'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'Script136 V01:   SUPERSEDED - permanent value parser bug'
);

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
            'deadlock-world-buff-contract-v02-'
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
    // PERMANENT PICKUPS
    // ========================================================

    const permanentFamilies =
        [];


    for (
        const [
            family,
            expected
        ]
        of Object.entries(
            EXPECTED_PERMANENT
        )
    ) {

        const tiers =
            [];


        for (
            let tier =
                1;

            tier <=
                3;

            tier++
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

                tiers.push(
                    {
                        tier,

                        recordKey,

                        found:
                            false
                    }
                );

                continue;
            }


            const modifier =
                parsePermanentModifier(
                    recordText
                );


            tiers.push(
                {
                    tier,

                    recordKey,

                    found:
                        true,

                    permanent:
                        captureScalarField(
                            recordText,
                            'm_bIsPermanentPickup'
                        ),

                    modifierClass:
                        modifier?.modifierClass
                        ??
                        null,

                    effects:
                        modifier?.effects
                        ??
                        [],

                    expected:
                        {
                            modifierValue:
                                expected.modifierValue,

                            value:
                                expected.values[
                                    tier -
                                    1
                                ]
                        }
                }
            );
        }


        permanentFamilies.push(
            {
                family,

                tiers
            }
        );
    }


    // ========================================================
    // BRIDGE POWERUPS
    // ========================================================

    const bridgePowerups =
        [];


    for (
        const [
            recordKey,
            expected
        ]
        of Object.entries(
            EXPECTED_BRIDGE
        )
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

            bridgePowerups.push(
                {
                    recordKey,

                    found:
                        false
                }
            );

            continue;
        }


        const modifier =
            parseBridgeModifier(
                recordText
            );


        bridgePowerups.push(
            {
                recordKey,

                found:
                    true,

                modifierClass:
                    modifier?.modifierClass
                    ??
                    null,

                durationSeconds:
                    modifier?.durationSeconds
                    ??
                    null,

                timeMinMinutes:
                    modifier?.timeMinMinutes
                    ??
                    null,

                timeMaxMinutes:
                    modifier?.timeMaxMinutes
                    ??
                    null,

                effects:
                    modifier?.effects
                    ??
                    [],

                uiDisplayTokens:
                    modifier?.uiDisplayTokens
                    ??
                    [],

                expected
            }
        );
    }


    // ========================================================
    // PRODUCER CANDIDATES
    // ========================================================

    const allPermanentRecordKeys =
        Object
            .keys(
                EXPECTED_PERMANENT
            )
            .flatMap(
                family => [
                    family,
                    `${family}_lv2`,
                    `${family}_lv3`
                ]
            );


    const producerCandidates =
        PRODUCER_CANDIDATE_KEYS.map(
            recordKey => {

                const text =
                    recordMap.get(
                        recordKey
                    )
                    ??
                    null;


                return {
                    recordKey,

                    found:
                        Boolean(
                            text
                        ),

                    referencedPermanentPickups:
                        text
                            ? allPermanentRecordKeys.filter(
                                target =>
                                    containsExactIdentifier(
                                        text,
                                        target
                                    )
                            )
                            : []
                };
            }
        );


    // ========================================================
    // LION STATUE
    // ========================================================

    const lionText =
        recordMap.get(
            LION_STATUE_RECORD
        )
        ??
        null;


    const lionStatueInspection =
        {
            found:
                Boolean(
                    lionText
                ),

            directPermanentPickupReferences:
                lionText
                    ? allPermanentRecordKeys.filter(
                        target =>
                            containsExactIdentifier(
                                lionText,
                                target
                            )
                    )
                    : [],

            smallGoldPickupReferenced:
                lionText
                    ? containsExactIdentifier(
                        lionText,
                        'small_gold_pickup'
                    )
                    : false
        };


    // ========================================================
    // VALIDATION: PERMANENT
    // ========================================================

    const permanentValidationRows =
        [];


    for (
        const family
        of permanentFamilies
    ) {

        for (
            const tier
            of family.tiers
        ) {

            const parsedEffect =
                tier.effects[
                    0
                ]
                ??
                null;


            const expectedEffect =
                tier.expected;


            permanentValidationRows.push(
                {
                    family:
                        family.family,

                    tier:
                        tier.tier,

                    found:
                        tier.found ===
                        true,

                    permanent:
                        tier.permanent ===
                        true,

                    modifierClassCorrect:
                        tier.modifierClass ===
                        'modifier_permanent_pickup',

                    exactlyOneEffect:
                        tier.effects.length ===
                        1,

                    modifierValueCorrect:
                        parsedEffect?.modifierValue ===
                        expectedEffect.modifierValue,

                    numericValuePresent:
                        Number.isFinite(
                            parsedEffect?.value
                        ),

                    valueCorrect:
                        numbersEqual(
                            parsedEffect?.value,
                            expectedEffect.value
                        )
                }
            );
        }
    }


    const allPermanentValid =
        permanentValidationRows.every(
            row =>
                row.found
                &&
                row.permanent
                &&
                row.modifierClassCorrect
                &&
                row.exactlyOneEffect
                &&
                row.modifierValueCorrect
                &&
                row.numericValuePresent
                &&
                row.valueCorrect
        );


    // ========================================================
    // VALIDATION: BRIDGE
    // ========================================================

    const bridgeValidationRows =
        [];


    for (
        const powerup
        of bridgePowerups
    ) {

        const expected =
            powerup.expected;


        const parsedEffects =
            new Map(
                powerup.effects.map(
                    effect => [
                        effect.modifierValue,
                        effect
                    ]
                )
            );


        const effectChecks =
            expected.effects.map(
                expectedEffect => {

                    const parsed =
                        parsedEffects.get(
                            expectedEffect.modifierValue
                        )
                        ??
                        null;


                    return {
                        modifierValue:
                            expectedEffect.modifierValue,

                        found:
                            Boolean(
                                parsed
                            ),

                        valueMinCorrect:
                            numbersEqual(
                                parsed?.valueMin,
                                expectedEffect.valueMin
                            ),

                        valueMaxCorrect:
                            numbersEqual(
                                parsed?.valueMax,
                                expectedEffect.valueMax
                            )
                    };
                }
            );


        bridgeValidationRows.push(
            {
                recordKey:
                    powerup.recordKey,

                found:
                    powerup.found ===
                    true,

                modifierClassCorrect:
                    powerup.modifierClass ===
                    expected.modifierClass,

                durationCorrect:
                    numbersEqual(
                        powerup.durationSeconds,
                        expected.durationSeconds
                    ),

                timeMinCorrect:
                    numbersEqual(
                        powerup.timeMinMinutes,
                        expected.timeMinMinutes
                    ),

                timeMaxCorrect:
                    numbersEqual(
                        powerup.timeMaxMinutes,
                        expected.timeMaxMinutes
                    ),

                effectCountCorrect:
                    powerup.effects.length ===
                    expected.effects.length,

                effectChecks,

                allEffectsCorrect:
                    effectChecks.every(
                        effect =>
                            effect.found
                            &&
                            effect.valueMinCorrect
                            &&
                            effect.valueMaxCorrect
                    )
            }
        );
    }


    const allBridgeValid =
        bridgeValidationRows.every(
            row =>
                row.found
                &&
                row.modifierClassCorrect
                &&
                row.durationCorrect
                &&
                row.timeMinCorrect
                &&
                row.timeMaxCorrect
                &&
                row.effectCountCorrect
                &&
                row.allEffectsCorrect
        );


    // ========================================================
    // TOP-LEVEL VALIDATION
    // ========================================================

    const validationChecks =
        {
            permanentRecords:
                {
                    actual:
                        permanentValidationRows.filter(
                            row =>
                                row.found
                        ).length,

                    expected:
                        18,

                    pass:
                        permanentValidationRows.filter(
                            row =>
                                row.found
                        ).length ===
                        18
                },

            permanentModifierValuesParsed:
                {
                    actual:
                        permanentValidationRows.filter(
                            row =>
                                row.numericValuePresent
                        ).length,

                    expected:
                        18,

                    pass:
                        permanentValidationRows.every(
                            row =>
                                row.numericValuePresent
                        )
                },

            permanentExactContract:
                {
                    actual:
                        permanentValidationRows.filter(
                            row =>
                                row.modifierValueCorrect
                                &&
                                row.valueCorrect
                        ).length,

                    expected:
                        18,

                    pass:
                        allPermanentValid
                },

            bridgeRecords:
                {
                    actual:
                        bridgeValidationRows.filter(
                            row =>
                                row.found
                        ).length,

                    expected:
                        4,

                    pass:
                        bridgeValidationRows.filter(
                            row =>
                                row.found
                        ).length ===
                        4
                },

            bridgeExactContract:
                {
                    actual:
                        bridgeValidationRows.filter(
                            row =>
                                row.allEffectsCorrect
                        ).length,

                    expected:
                        4,

                    pass:
                        allBridgeValid
                }
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


    // ========================================================
    // STATUS
    // ========================================================

    const status =
        validationPass
            ? 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'
            : 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_REQUIRES_DIAGNOSIS';


    const nextStage =
        validationPass
            ? 'BUILD_CURRENT_PURCHASABLE_ITEM_STAT_CATALOG'
            : 'DIAGNOSE_ONLY_FAILED_WORLD_BUFF_CONTRACT_FIELDS';


    // ========================================================
    // OUTPUT
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

            supersedes:
                {
                    artifact:
                        'world_stat_buff_resource_contract_v01.json',

                    reason:
                        'V01 failed to parse nested permanent m_vecScriptValues and did not validate non-null permanent modifier values.'
                },

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
                    families:
                        permanentFamilies,

                    validation:
                        permanentValidationRows,

                    interpretation:
                        {
                            permanentFlag:
                                'RESOURCE_VALIDATED',

                            modifierToken:
                                'RESOURCE_VALIDATED',

                            exactValue:
                                'RESOURCE_VALIDATED',

                            actualReplayAcquisition:
                                'UNRESOLVED',

                            replayStackCount:
                                'UNRESOLVED'
                        }
                },

            bridgePowerups:
                {
                    powerups:
                        bridgePowerups,

                    validation:
                        bridgeValidationRows,

                    interpretation:
                        {
                            duration:
                                'RESOURCE_VALIDATED',

                            timeBounds:
                                'RESOURCE_VALIDATED',

                            endpointValues:
                                'RESOURCE_VALIDATED',

                            exactInterpolationFunction:
                                'UNRESOLVED',

                            actualReplayAcquisition:
                                'UNRESOLVED'
                        }
                },

            producerCandidates,

            lionStatueInspection,

            guardrails:
                {
                    installedBuildOnly:
                        'This contract is bound to the currently installed local Deadlock build.',

                    futurePatch:
                        'If the resource values change, this validator should fail and a new contract version should be created.',

                    runtimeState:
                        'Resource-defined effects are not evidence that a particular replay player possessed the effect at a specific time.',

                    bridgeInterpolation:
                        'm_valueMin/m_valueMax and m_flTimeMin/m_flTimeMax establish endpoints and time bounds but not the exact interpolation function.',

                    movementUnits:
                        'Raw sprint-speed modifier values remain in resource units. No player-facing unit conversion is frozen here.'
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
    // CONSOLE
    // ========================================================

    console.log(
        '========================================================'
    );

    console.log(
        'PERMANENT PICKUP CONTRACT'
    );

    console.log(
        '========================================================'
    );

    console.log('');


    for (
        const family
        of permanentFamilies
    ) {

        console.log(
            family.family
        );


        for (
            const tier
            of family.tiers
        ) {

            const effect =
                tier.effects[
                    0
                ]
                ??
                null;


            console.log(
                `  tier=${tier.tier} ` +
                `${String(effect?.modifierValue ?? 'null').padEnd(58)} ` +
                `value=${String(effect?.value ?? 'null').padEnd(8)} ` +
                `permanent=${tier.permanent}`
            );
        }


        console.log('');
    }


    console.log(
        '========================================================'
    );

    console.log(
        'BRIDGE POWERUP CONTRACT'
    );

    console.log(
        '========================================================'
    );

    console.log('');


    for (
        const powerup
        of bridgePowerups
    ) {

        console.log(
            powerup.recordKey
        );


        console.log(
            `  ${powerup.modifierClass}`
        );


        console.log(
            `  duration=${powerup.durationSeconds}s ` +
            `timeMin=${powerup.timeMinMinutes}m ` +
            `timeMax=${powerup.timeMaxMinutes}m`
        );


        for (
            const effect
            of powerup.effects
        ) {

            console.log(
                `  ${effect.modifierValue.padEnd(58)} ` +
                `min=${effect.valueMin} ` +
                `max=${effect.valueMax}`
            );
        }


        console.log('');
    }


    console.log(
        '========================================================'
    );

    console.log(
        'VALIDATION'
    );

    console.log(
        '========================================================'
    );

    console.log('');


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
            `${name.padEnd(42)} ` +
            `${row.pass} ` +
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
// PERMANENT MODIFIER PARSER
// ============================================================

function parsePermanentModifier(
    recordText
) {

    const modifier =
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
        !modifier
    ) {

        return null;
    }


    const flat =
        parseFlatScalarMap(
            modifier.inner
        );


    const scriptValues =
        extractNamedArrayField(
            modifier.inner,
            'm_vecScriptValues'
        );


    const effects =
        [];


    if (
        scriptValues
    ) {

        for (
            const objectText
            of extractObjectBodies(
                scriptValues.inner
            )
        ) {

            const child =
                parseFlatScalarMap(
                    objectText
                );


            if (
                child.m_eModifierValue ===
                undefined
            ) {

                continue;
            }


            effects.push(
                {
                    modifierValue:
                        String(
                            child.m_eModifierValue
                        ),

                    value:
                        finite(
                            child.m_value
                        )
                }
            );
        }
    }


    // Fallback for an inline single-value representation.
    if (
        effects.length ===
        0
        &&
        flat.m_eModifierValue !==
        undefined
    ) {

        effects.push(
            {
                modifierValue:
                    String(
                        flat.m_eModifierValue
                    ),

                value:
                    finite(
                        flat.m_value
                    )
            }
        );
    }


    return {
        modifierClass:
            flat._class
            ??
            flat._my_subclass_name
            ??
            null,

        effects
    };
}


// ============================================================
// BRIDGE MODIFIER PARSER
// ============================================================

function parseBridgeModifier(
    recordText
) {

    const modifier =
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
        !modifier
    ) {

        return null;
    }


    const flat =
        parseFlatScalarMap(
            modifier.inner
        );


    const valueArray =
        extractNamedArrayField(
            modifier.inner,
            'm_vecModifierValues'
        );


    const effects =
        [];


    if (
        valueArray
    ) {

        for (
            const objectText
            of extractObjectBodies(
                valueArray.inner
            )
        ) {

            const child =
                parseFlatScalarMap(
                    objectText
                );


            if (
                child.m_eModifierValue ===
                undefined
            ) {

                continue;
            }


            effects.push(
                {
                    modifierValue:
                        String(
                            child.m_eModifierValue
                        ),

                    valueMin:
                        finite(
                            child.m_valueMin
                        ),

                    valueMax:
                        finite(
                            child.m_valueMax
                        )
                }
            );
        }
    }


    return {
        modifierClass:
            flat._class
            ??
            flat._my_subclass_name
            ??
            null,

        durationSeconds:
            finite(
                flat.m_flDuration
            ),

        timeMinMinutes:
            finite(
                flat.m_flTimeMin
            ),

        timeMaxMinutes:
            finite(
                flat.m_flTimeMax
            ),

        effects,

        uiDisplayTokens:
            parseQuotedArrayField(
                modifier.inner,
                'm_vecAlwaysShowInStatModifierUI'
            )
    };
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
// OBJECTS INSIDE ARRAY
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
// QUOTED ARRAY
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
// SCALAR CAPTURE
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
// EXACT IDENTIFIER
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


    return {
        success:
            Boolean(
                localPath
            ),

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


        if (
            index >=
            text.length
        ) {

            break;
        }


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
// DELIMITERS
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
        start >=
        text.length
    ) {

        return null;
    }


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


function numbersEqual(
    a,
    b
) {

    const left =
        finite(
            a
        );


    const right =
        finite(
            b
        );


    if (
        left ===
        null
        ||
        right ===
        null
    ) {

        return false;
    }


    return Math.abs(
        left -
        right
    ) <
        1e-6;
}


// ============================================================
// REGEX
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
// FILE SEARCH
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