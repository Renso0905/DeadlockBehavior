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
    'WORLD_STAT_BUFF_RESOURCE_CATALOG_V01';


// ============================================================
// PURPOSE
//
// Script132 V02 discovered a broad modifier-source universe.
//
// Its keyword-derived source classes are intentionally
// recall-oriented and contain false positives.
//
// Script133 does NOT use broad keyword classification.
//
// Instead, it resolves a small set of explicit resource records
// already discovered in the installed build:
//
// PERMANENT STAT PICKUPS
//
//   spirit_permanent_pickup
//   firerate_permanent_pickup
//   ammo_permanent_pickup
//   hp_permanent_pickup
//   cd_permanent_pickup
//   wp_permanent_pickup
//
// Each currently appears with:
//
//   base
//   _lv2
//   _lv3
//
// BRIDGE POWERUPS
//
//   gun_powerup_pickup
//   survival_powerup_pickup
//   casting_powerup_pickup
//   movement_powerup_pickup
//
// GOLDEN IDOL / STATUE SUPPORT
//
//   ability_golden_idol
//   m_IdolParams
//   citadel_breakable_lion_statue
//   citadel_item_pickup_idol
//
// SINNER'S SACRIFICE SUPPORT
//
//   neutral_sinners_sacrifice
//   npc_neutral_sinners_sacrifice_hideout
//
// For each selected record this script:
//
//   - extracts scalar fields
//   - extracts enum / identifier references
//   - resolves references to other VData records
//   - follows links into abilities.vdata where possible
//   - extracts m_mapAbilityProperties from linked abilities
//   - extracts MODIFIER_VALUE_* tokens
//
// This is still RESOURCE SEMANTIC DISCOVERY.
//
// It does NOT yet claim:
//
//   - exact gameplay duration
//   - acquisition telemetry
//   - stacking rules
//   - additive/multiplicative order
//   - that all fields are effective runtime stats
//
// No replay parsing.
// No effective PlayerState(t).
//
// OUTPUT DISCIPLINE:
//
// One compact JSON checkpoint only.
// No Markdown output.
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


const SCRIPT132_PATH =
    resolve(
        'output',
        'cross_replay',
        'player_stat_modifier_source_universe_discovery_v02.json'
    );


const OUTPUT_JSON_PATH =
    resolve(
        'output',
        'cross_replay',
        'world_stat_buff_resource_catalog_v01.json'
    );


// ============================================================
// RESOURCE SURFACES
// ============================================================

const RESOURCE_PATHS =
    [
        'scripts/abilities.vdata_c',
        'scripts/misc.vdata_c',
        'scripts/generic_data.vdata_c',
        'scripts/npc_units.vdata_c'
    ];


// ============================================================
// TARGET RECORDS
// ============================================================

const PERMANENT_PICKUP_FAMILIES =
    [
        'spirit_permanent_pickup',
        'firerate_permanent_pickup',
        'ammo_permanent_pickup',
        'hp_permanent_pickup',
        'cd_permanent_pickup',
        'wp_permanent_pickup'
    ];


const PERMANENT_PICKUP_RECORDS =
    PERMANENT_PICKUP_FAMILIES.flatMap(
        base => [
            base,
            `${base}_lv2`,
            `${base}_lv3`
        ]
    );


const BRIDGE_POWERUP_RECORDS =
    [
        'gun_powerup_pickup',
        'survival_powerup_pickup',
        'casting_powerup_pickup',
        'movement_powerup_pickup'
    ];


const GOLDEN_IDOL_RECORDS =
    [
        'ability_golden_idol',
        'm_IdolParams',
        'citadel_breakable_lion_statue',
        'citadel_item_pickup_idol'
    ];


const SINNER_RECORDS =
    [
        'neutral_sinners_sacrifice',
        'npc_neutral_sinners_sacrifice_hideout'
    ];


const TARGET_RECORDS =
    [
        ...PERMANENT_PICKUP_RECORDS,
        ...BRIDGE_POWERUP_RECORDS,
        ...GOLDEN_IDOL_RECORDS,
        ...SINNER_RECORDS
    ];


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


if (
    !existsSync(
        SCRIPT132_PATH
    )
) {

    throw new Error(
        [
            'Missing Script132 V02 checkpoint:',
            SCRIPT132_PATH
        ].join(
            '\n'
        )
    );
}


const script132 =
    JSON.parse(
        readFileSync(
            SCRIPT132_PATH,
            'utf8'
        )
    );


if (
    script132?.status !==
    'PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_READY_FOR_INTERPRETATION'
) {

    throw new Error(
        `Script132 V02 not ready. Status=${script132?.status}`
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
            'Checked:',
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
    'WORLD STAT BUFF RESOURCE CATALOG V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'Foundation:       Script132 V02'
);

console.log(
    'Classification:   EXPLICIT RECORDS, NOT KEYWORD SEARCH'
);

console.log(
    'Replay parsing:   NONE'
);

console.log(
    'Effective stats:  NOT CALCULATED'
);

console.log(
    'Output:           ONE COMPACT JSON'
);

console.log('');


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-world-stat-buffs-'
        )
    );


const extractedResources =
    [];


// ============================================================
// EXTRACT RESOURCES
// ============================================================

for (
    const resourcePath
    of RESOURCE_PATHS
) {

    const result =
        extractSingleResource({
            source2ViewerPath:
                SOURCE2VIEWER_PATH,

            pakPath,

            resourcePath,

            temporaryDirectory
        });


    if (
        !result.success
    ) {

        console.log(
            `MISS ${resourcePath}`
        );

        continue;
    }


    extractedResources.push(
        result
    );


    console.log(
        `PASS ${resourcePath} bytes=${result.bytes}`
    );
}


console.log('');


// ============================================================
// BUILD RESOURCE RECORD MAPS
// ============================================================

const resourceMaps =
    new Map();


const globalRecordMap =
    new Map();


for (
    const resource
    of extractedResources
) {

    const text =
        readFileSync(
            resource.localPath,
            'utf8'
        );


    const root =
        extractKv3Root(
            text
        );


    if (
        !root
    ) {

        throw new Error(
            `Could not find KV3 root for ${resource.resourcePath}`
        );
    }


    const entries =
        parseTopLevelEntries(
            root.inner
        );


    const recordMap =
        new Map();


    for (
        const entry
        of entries
    ) {

        if (
            entry.type !==
            'object'
        ) {

            continue;
        }


        const record =
            {
                resourcePath:
                    resource.resourcePath,

                recordKey:
                    entry.key,

                recordText:
                    entry.inner
            };


        recordMap.set(
            entry.key,
            record
        );


        if (
            !globalRecordMap.has(
                entry.key
            )
        ) {

            globalRecordMap.set(
                entry.key,
                []
            );
        }


        globalRecordMap.get(
            entry.key
        ).push(
            record
        );
    }


    resourceMaps.set(
        resource.resourcePath,
        recordMap
    );
}


// ============================================================
// RESOLVE TARGETS
// ============================================================

const targetResults =
    [];


for (
    const targetKey
    of TARGET_RECORDS
) {

    const matches =
        globalRecordMap.get(
            targetKey
        )
        ??
        [];


    if (
        matches.length ===
        0
    ) {

        targetResults.push(
            {
                targetKey,

                found:
                    false,

                matches:
                    []
            }
        );

        continue;
    }


    targetResults.push(
        {
            targetKey,

            found:
                true,

            matches:
                matches.map(
                    record =>
                        summarizeRecord(
                            record,
                            globalRecordMap
                        )
                )
        }
    );
}


// ============================================================
// GROUP TARGETS
// ============================================================

const resultByKey =
    new Map(
        targetResults.map(
            row => [
                row.targetKey,
                row
            ]
        )
    );


const permanentPickups =
    PERMANENT_PICKUP_RECORDS.map(
        key =>
            resultByKey.get(
                key
            )
    );


const bridgePowerups =
    BRIDGE_POWERUP_RECORDS.map(
        key =>
            resultByKey.get(
                key
            )
    );


const goldenIdol =
    GOLDEN_IDOL_RECORDS.map(
        key =>
            resultByKey.get(
                key
            )
    );


const sinnersSacrifice =
    SINNER_RECORDS.map(
        key =>
            resultByKey.get(
                key
            )
    );


// ============================================================
// LINKED RECORD CATALOG
//
// Follow one hop from every explicit target into any other
// top-level VData record whose identifier appears in the target.
//
// This is useful for:
//
//   pickup -> effect ability
//   pickup -> modifier
//   idol params -> pickup class
//
// We intentionally stop at one hop in V01.
// ============================================================

const linkedRecordKeys =
    new Set();


for (
    const target
    of targetResults
) {

    for (
        const match
        of target.matches
        ??
        []
    ) {

        for (
            const link
            of match.recordLinks
        ) {

            linkedRecordKeys.add(
                link.recordKey
            );
        }
    }
}


for (
    const targetKey
    of TARGET_RECORDS
) {

    linkedRecordKeys.delete(
        targetKey
    );
}


const linkedRecords =
    [];


for (
    const recordKey
    of [
        ...linkedRecordKeys
    ].sort()
) {

    const matches =
        globalRecordMap.get(
            recordKey
        )
        ??
        [];


    for (
        const record
        of matches
    ) {

        linkedRecords.push(
            summarizeRecord(
                record,
                globalRecordMap,
                {
                    resolveLinks:
                        false
                }
            )
        );
    }
}


// ============================================================
// PERMANENT FAMILY STRUCTURE
// ============================================================

const permanentFamilySummary =
    PERMANENT_PICKUP_FAMILIES.map(
        family => {

            const keys =
                [
                    family,
                    `${family}_lv2`,
                    `${family}_lv3`
                ];


            return {
                family,

                records:
                    keys.map(
                        key => {

                            const row =
                                resultByKey.get(
                                    key
                                );


                            return {
                                recordKey:
                                    key,

                                found:
                                    row?.found
                                    ??
                                    false,

                                resources:
                                    (
                                        row?.matches
                                        ??
                                        []
                                    )
                                        .map(
                                            match =>
                                                match.resourcePath
                                        )
                            };
                        }
                    )
            };
        }
    );


// ============================================================
// VALIDATION
// ============================================================

const foundPermanentCount =
    permanentPickups.filter(
        row =>
            row?.found ===
            true
    ).length;


const foundBridgeCount =
    bridgePowerups.filter(
        row =>
            row?.found ===
            true
    ).length;


const foundGoldenIdolCount =
    goldenIdol.filter(
        row =>
            row?.found ===
            true
    ).length;


const validationChecks =
    {
        script132Ready:
            check(
                script132.status,
                'PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_READY_FOR_INTERPRETATION',
                true
            ),


        resourceExtractionAvailable:
            check(
                extractedResources.length,
                RESOURCE_PATHS.length,
                extractedResources.length ===
                RESOURCE_PATHS.length
            ),


        allPermanentPickupTierRecordsFound:
            check(
                foundPermanentCount,
                PERMANENT_PICKUP_RECORDS.length,
                foundPermanentCount ===
                PERMANENT_PICKUP_RECORDS.length
            ),


        allFourBridgePowerupsFound:
            check(
                foundBridgeCount,
                BRIDGE_POWERUP_RECORDS.length,
                foundBridgeCount ===
                BRIDGE_POWERUP_RECORDS.length
            ),


        goldenIdolSupportRecordsFound:
            check(
                foundGoldenIdolCount,
                `>=3/${GOLDEN_IDOL_RECORDS.length}`,
                foundGoldenIdolCount >=
                3
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


// ============================================================
// STATUS
// ============================================================

const status =
    validationPass
        ? 'WORLD_STAT_BUFF_RESOURCE_CATALOG_READY_FOR_INTERPRETATION'
        : 'WORLD_STAT_BUFF_RESOURCE_CATALOG_REQUIRES_DIAGNOSIS';


const nextStage =
    validationPass
        ? 'INTERPRET_EXACT_PERMANENT_PICKUP_AND_BRIDGE_POWERUP_EFFECT_FIELDS_THEN_BUILD_ITEM_CATALOG'
        : 'DIAGNOSE_MISSING_EXPLICIT_WORLD_BUFF_RECORDS';


// ============================================================
// OUTPUT
// ============================================================

const output =
    {
        version:
            VERSION,

        canonical:
            false,

        createdAt:
            new Date().toISOString(),

        status,

        source:
            {
                method:
                    'EXPLICIT_LOCAL_VDATA_RECORD_RESOLUTION',

                pakPath,

                extractedResources:
                    extractedResources.map(
                        row => ({
                            resourcePath:
                                row.resourcePath,

                            bytes:
                                row.bytes,

                            sha256:
                                row.sha256
                        })
                    )
            },

        scope:
            {
                permanentPickupFamilies:
                    PERMANENT_PICKUP_FAMILIES,

                permanentPickupRecords:
                    PERMANENT_PICKUP_RECORDS,

                bridgePowerupRecords:
                    BRIDGE_POWERUP_RECORDS,

                goldenIdolRecords:
                    GOLDEN_IDOL_RECORDS,

                sinnersSacrificeRecords:
                    SINNER_RECORDS
            },

        permanentFamilySummary,

        permanentPickups,

        bridgePowerups,

        goldenIdol,

        sinnersSacrifice,

        linkedRecords,

        validation:
            {
                pass:
                    validationPass,

                checks:
                    validationChecks
            },

        interpretation:
            {
                explicitVsKeyword:
                    'Target membership is based on explicit record identity, not broad keyword classification.',

                permanentPickups:
                    'The six permanent pickup families and their three apparent level variants are treated as a resource structure. Their exact gameplay values and stacking semantics remain to be interpreted from the resolved fields.',

                bridgePowerups:
                    'The four normal bridge Powerup records are treated as the explicit temporary Powerup family.',

                goldenIdol:
                    'Golden Idol/statue support records are retained separately because the world object, acquisition ability, pickup entity and global Idol parameters may each carry different parts of the mechanic.',

                sinnersSacrifice:
                    'Sinner records are source-support records only in this checkpoint; no reward equivalence to Golden Statue acquisition is assumed.',

                finalGoal:
                    'Validated world-buff effects will later become inputs to PlayerState(t), alongside hero progression, category investment and owned items.'
            },

        nextStage,

        output:
            OUTPUT_JSON_PATH
    };


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


// ============================================================
// CLEAN TEMP
// ============================================================

rmSync(
    temporaryDirectory,
    {
        recursive:
            true,

        force:
            true
    }
);


// ============================================================
// CONSOLE
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'PERMANENT STAT PICKUP FAMILY'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const family
    of permanentFamilySummary
) {

    console.log(
        family.family
    );


    for (
        const row
        of family.records
    ) {

        console.log(
            `  ${row.recordKey.padEnd(42)} ` +
            `found=${row.found} ` +
            `resources=${row.resources.join(',')}`
        );
    }


    console.log('');
}


console.log(
    '========================================================'
);

console.log(
    'BRIDGE POWERUP FAMILY'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const row
    of bridgePowerups
) {

    printTargetResult(
        row
    );
}


console.log('');

console.log(
    '========================================================'
);

console.log(
    'GOLDEN IDOL / STATUE SUPPORT'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const row
    of goldenIdol
) {

    printTargetResult(
        row
    );
}


console.log('');

console.log(
    '========================================================'
);

console.log(
    'SINNER SUPPORT'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const row
    of sinnersSacrifice
) {

    printTargetResult(
        row
    );
}


console.log('');

console.log(
    '========================================================'
);

console.log(
    'TARGET RECORD EFFECT / REFERENCE SUMMARY'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const target
    of targetResults
) {

    if (
        !target.found
    ) {

        console.log(
            `${target.targetKey}: MISSING`
        );

        continue;
    }


    console.log(
        `${target.targetKey}`
    );


    for (
        const match
        of target.matches
    ) {

        console.log(
            `  resource=${match.resourcePath}`
        );


        console.log(
            `  scalarFields=${match.scalarAssignments.length}`
        );


        for (
            const scalar
            of match.scalarAssignments.slice(
                0,
                40
            )
        ) {

            console.log(
                `    ${scalar.key} = ${formatValue(scalar.value)}`
            );
        }


        if (
            match.scalarAssignments.length >
            40
        ) {

            console.log(
                `    ... ${match.scalarAssignments.length - 40} more scalar fields in JSON`
            );
        }


        console.log(
            `  modifierTokens=${JSON.stringify(match.modifierValueTokens)}`
        );


        console.log(
            `  abilityProperties=${match.abilityProperties.length}`
        );


        for (
            const property
            of match.abilityProperties.slice(
                0,
                30
            )
        ) {

            console.log(
                `    ${property.propertyKey} ` +
                `value=${formatValue(property.value)} ` +
                `provided=${formatValue(property.providedPropertyType)}`
            );
        }


        if (
            match.recordLinks.length >
            0
        ) {

            console.log(
                '  links:'
            );


            for (
                const link
                of match.recordLinks
            ) {

                console.log(
                    `    ${link.recordKey} -> ${link.resources.join(',')}`
                );
            }
        }
    }


    console.log('');
}


console.log(
    '========================================================'
);

console.log(
    'LINKED ABILITY / EFFECT RECORDS'
);

console.log(
    '========================================================'
);

console.log('');


if (
    linkedRecords.length ===
    0
) {

    console.log(
        'NONE RESOLVED'
    );

} else {

    for (
        const record
        of linkedRecords
    ) {

        console.log(
            `${record.recordKey} [${record.resourcePath}]`
        );


        console.log(
            `  modifiers=${JSON.stringify(record.modifierValueTokens)}`
        );


        console.log(
            `  properties=${record.abilityProperties.length}`
        );


        for (
            const property
            of record.abilityProperties.slice(
                0,
                20
            )
        ) {

            console.log(
                `    ${property.propertyKey} ` +
                `value=${formatValue(property.value)} ` +
                `provided=${formatValue(property.providedPropertyType)}`
            );
        }


        console.log('');
    }
}


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


// ============================================================
// RECORD SUMMARY
// ============================================================

function summarizeRecord(
    record,
    globalMap,
    options =
        {}
) {

    const resolveLinks =
        options.resolveLinks
        ??
        true;


    const scalarAssignments =
        extractScalarAssignments(
            record.recordText
        );


    const modifierValueTokens =
        uniqueMatches(
            record.recordText,
            /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g
        );


    const propertyBlock =
        extractBalancedFieldBlock(
            record.recordText,
            'm_mapAbilityProperties'
        );


    const abilityProperties =
        propertyBlock
            ? parseAbilityProperties(
                propertyBlock.inner
            )
            : [];


    const recordLinks =
        resolveLinks
            ? resolveRecordLinks(
                record.recordText,
                record.recordKey,
                globalMap
            )
            : [];


    return {
        resourcePath:
            record.resourcePath,

        recordKey:
            record.recordKey,

        scalarAssignments,

        modifierValueTokens,

        abilityProperties,

        recordLinks
    };
}


// ============================================================
// RECORD LINK RESOLUTION
// ============================================================

function resolveRecordLinks(
    recordText,
    ownRecordKey,
    globalMap
) {

    const tokens =
        new Set(
            [
                ...recordText.matchAll(
                    /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g
                )
            ]
                .map(
                    match =>
                        match[
                            0
                        ]
                )
        );


    tokens.delete(
        ownRecordKey
    );


    const links =
        [];


    for (
        const token
        of tokens
    ) {

        if (
            !globalMap.has(
                token
            )
        ) {

            continue;
        }


        const records =
            globalMap.get(
                token
            );


        links.push(
            {
                recordKey:
                    token,

                resources:
                    [
                        ...new Set(
                            records.map(
                                row =>
                                    row.resourcePath
                            )
                        )
                    ].sort()
            }
        );
    }


    return links.sort(
        (
            a,
            b
        ) =>
            a.recordKey.localeCompare(
                b.recordKey
            )
    );
}


// ============================================================
// ABILITY PROPERTIES
// ============================================================

function parseAbilityProperties(
    block
) {

    const rows =
        [];


    for (
        const entry
        of parseTopLevelEntries(
            block
        )
    ) {

        if (
            entry.type !==
            'object'
        ) {

            continue;
        }


        const flat =
            parseFlatScalarMap(
                entry.inner
            );


        rows.push(
            {
                propertyKey:
                    entry.key,

                value:
                    firstPresent(
                        flat,
                        [
                            'm_strValue',
                            'm_strVAlue',
                            'm_flValue',
                            'm_nValue'
                        ]
                    ),

                providedPropertyType:
                    firstPresent(
                        flat,
                        [
                            'm_eProvidedPropertyType'
                        ]
                    ),

                displayUnits:
                    firstPresent(
                        flat,
                        [
                            'm_eDisplayUnits'
                        ]
                    ),

                usageFlags:
                    firstPresent(
                        flat,
                        [
                            'm_eStatsUsageFlags'
                        ]
                    ),

                modifierValueTokens:
                    uniqueMatches(
                        entry.inner,
                        /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g
                    )
            }
        );
    }


    return rows;
}


// ============================================================
// SCALAR ASSIGNMENT DISCOVERY
//
// Captures scalar assignment lines regardless of nesting.
//
// This is intentionally used for selected records only.
// ============================================================

function extractScalarAssignments(
    text
) {

    const rows =
        [];


    const lines =
        text.split(
            /\r?\n/
        );


    for (
        let index =
            0;

        index <
            lines.length;

        index++
    ) {

        const line =
            lines[
                index
            ];


        const match =
            line.match(
                /^\s*"?([A-Za-z0-9_:.\/\-]+)"?\s*=\s*(.+?)\s*,?\s*$/
            );


        if (
            !match
        ) {

            continue;
        }


        const rawValue =
            match[
                2
            ].trim();


        if (
            rawValue ===
            '{'
            ||
            rawValue ===
            '['
        ) {

            continue;
        }


        if (
            rawValue.endsWith(
                '{'
            )
            ||
            rawValue.endsWith(
                '['
            )
        ) {

            continue;
        }


        rows.push(
            {
                lineNumber:
                    index +
                    1,

                key:
                    match[
                        1
                    ],

                value:
                    parseScalar(
                        rawValue
                    )
            }
        );
    }


    return rows;
}


// ============================================================
// PRINT TARGET
// ============================================================

function printTargetResult(
    row
) {

    console.log(
        `${row.targetKey.padEnd(48)} found=${row.found}`
    );


    if (
        !row.found
    ) {

        return;
    }


    for (
        const match
        of row.matches
    ) {

        console.log(
            `  resource=${match.resourcePath} ` +
            `scalars=${match.scalarAssignments.length} ` +
            `properties=${match.abilityProperties.length} ` +
            `links=${match.recordLinks.length}`
        );
    }
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
                    256 *
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
                false,

            resourcePath
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
        ||
        !existsSync(
            localPath
        )
    ) {

        return {
            success:
                false,

            resourcePath
        };
    }


    const buffer =
        readFileSync(
            localPath
        );


    return {
        success:
            true,

        resourcePath,

        localPath,

        bytes:
            buffer.length,

        sha256:
            createHash(
                'sha256'
            )
                .update(
                    buffer
                )
                .digest(
                    'hex'
                )
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
// BALANCED FIELD BLOCK
// ============================================================

function extractBalancedFieldBlock(
    text,
    fieldName
) {

    const match =
        new RegExp(
            `${escapeRegex(fieldName)}\\s*=\\s*\\{`,
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
                    scalar.value,

                inner:
                    null
            }
        );


        index =
            scalar.end;
    }


    return rows;
}


// ============================================================
// FLAT MAP
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
// DELIMITER PARSER
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
// WHITESPACE / KEY / SCALAR
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
// HELPERS
// ============================================================

function uniqueMatches(
    text,
    regex
) {

    return [
        ...new Set(
            [
                ...text.matchAll(
                    regex
                )
            ]
                .map(
                    match =>
                        match[
                            0
                        ]
                )
        )
    ];
}


function firstPresent(
    object,
    keys
) {

    for (
        const key
        of keys
    ) {

        if (
            Object.prototype.hasOwnProperty.call(
                object,
                key
            )
        ) {

            return object[
                key
            ];
        }
    }


    return null;
}


function formatValue(
    value
) {

    if (
        value ===
        null
        ||
        value ===
        undefined
    ) {

        return 'null';
    }


    const text =
        typeof value ===
        'string'
            ? value
            : JSON.stringify(
                value
            );


    return text.length >
        100
            ? `${text.slice(0, 97)}...`
            : text;
}


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