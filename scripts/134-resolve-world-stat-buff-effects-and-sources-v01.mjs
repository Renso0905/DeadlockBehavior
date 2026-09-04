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
    'WORLD_STAT_BUFF_EFFECTS_AND_SOURCES_V01';


// ============================================================
// PURPOSE
//
// Script133 established:
//
//   - six permanent stat-pickup families
//   - three level variants for each
//   - four bridge Powerup families
//   - modifier token identities
//
// It also exposed an interpretation correction:
//
//   ability_golden_idol
//   m_IdolParams
//   citadel_item_pickup_idol
//
// are strongly Urn-related rather than Golden-Statue records.
//
// Script134 performs two narrow tasks:
//
// 1. EFFECT SEMANTICS
//
//    Parse the actual nested modifier structures for:
//
//      permanent pickups
//      bridge Powerups
//
//    preserving:
//
//      modifier class
//      m_vecScriptValues
//      modifier-value token
//      numeric / structured value
//      duration/timing-related fields
//
// 2. SOURCE TRACE
//
//    Search the local VData record graph for exact references to:
//
//      spirit_permanent_pickup
//      firerate_permanent_pickup
//      ammo_permanent_pickup
//      hp_permanent_pickup
//      cd_permanent_pickup
//      wp_permanent_pickup
//
//    and their level variants.
//
//    This determines which world/resource records actually point
//    to these pickups.
//
// IMPORTANT:
//
// Exact resource reference != replay acquisition.
//
// This script does NOT:
//
//   - parse replays
//   - determine actual pickup ownership
//   - infer stack counts
//   - calculate PlayerState(t)
//   - infer additive/multiplicative stacking order
//
// OUTPUT:
//
// One compact JSON.
// No Markdown.
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


const SCRIPT133_PATH =
    resolve(
        'output',
        'cross_replay',
        'world_stat_buff_resource_catalog_v01.json'
    );


const OUTPUT_JSON_PATH =
    resolve(
        'output',
        'cross_replay',
        'world_stat_buff_effects_and_sources_v01.json'
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
// PERMANENT PICKUPS
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
// URN / IDOL CORRECTION COHORT
// ============================================================

const URN_IDOL_RECORDS =
    [
        'ability_golden_idol',
        'm_IdolParams',
        'citadel_item_pickup_idol'
    ];


// ============================================================
// STATUE RECORD CURRENTLY OBSERVED
// ============================================================

const LION_STATUE_RECORD =
    'citadel_breakable_lion_statue';


// ============================================================
// DEADLOCK INSTALL
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
        SCRIPT133_PATH
    )
) {

    throw new Error(
        `Missing Script133 output:\n${SCRIPT133_PATH}`
    );
}


const script133 =
    JSON.parse(
        readFileSync(
            SCRIPT133_PATH,
            'utf8'
        )
    );


if (
    script133?.status !==
    'WORLD_STAT_BUFF_RESOURCE_CATALOG_READY_FOR_INTERPRETATION'
) {

    throw new Error(
        `Script133 not ready. Status=${script133?.status}`
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
    'WORLD STAT BUFF EFFECTS + SOURCES V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'Foundation:       Script133'
);

console.log(
    'Replay parsing:   NONE'
);

console.log(
    'Effect source:    LOCAL VDATA'
);

console.log(
    'Reference trace:  EXACT RECORD IDENTIFIERS'
);

console.log(
    'Output:           ONE JSON'
);

console.log('');


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-world-buff-effects-'
        )
    );


const extractedResources =
    [];


// ============================================================
// EXTRACT
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

        throw new Error(
            `Failed to extract ${resourcePath}`
        );
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
// BUILD RECORD GRAPH
// ============================================================

const records =
    [];


const globalMap =
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
            `KV3 root unresolved: ${resource.resourcePath}`
        );
    }


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


        const record =
            {
                resourcePath:
                    resource.resourcePath,

                recordKey:
                    entry.key,

                recordText:
                    entry.inner
            };


        records.push(
            record
        );


        if (
            !globalMap.has(
                entry.key
            )
        ) {

            globalMap.set(
                entry.key,
                []
            );
        }


        globalMap.get(
            entry.key
        ).push(
            record
        );
    }
}


// ============================================================
// PERMANENT EFFECT CATALOG
// ============================================================

const permanentEffects =
    [];


for (
    const recordKey
    of PERMANENT_RECORDS
) {

    const record =
        getUniqueRecord(
            globalMap,
            recordKey
        );


    if (
        !record
    ) {

        permanentEffects.push(
            {
                recordKey,

                found:
                    false
            }
        );

        continue;
    }


    const modifier =
        parsePrimaryModifier(
            record.recordText
        );


    permanentEffects.push(
        {
            recordKey,

            family:
                resolvePermanentFamily(
                    recordKey
                ),

            tier:
                resolvePermanentTier(
                    recordKey
                ),

            found:
                true,

            resourcePath:
                record.resourcePath,

            isPermanentPickup:
                captureScalarField(
                    record.recordText,
                    'm_bIsPermanentPickup'
                ),

            baseRecord:
                captureScalarField(
                    record.recordText,
                    '_base'
                ),

            modifier
        }
    );
}


// ============================================================
// NORMALIZED PERMANENT TABLE
// ============================================================

const permanentFamilyTables =
    PERMANENT_FAMILIES.map(
        family => {

            const rows =
                permanentEffects
                    .filter(
                        row =>
                            row.family ===
                            family
                            &&
                            row.found
                    )
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            a.tier -
                            b.tier
                    );


            return {
                family,

                rows:
                    rows.map(
                        row => ({
                            tier:
                                row.tier,

                            recordKey:
                                row.recordKey,

                            modifierClass:
                                row.modifier?.modifierClass
                                ??
                                null,

                            scriptValues:
                                row.modifier?.scriptValues
                                ??
                                []
                        })
                    )
            };
        }
    );


// ============================================================
// BRIDGE EFFECT CATALOG
// ============================================================

const bridgeEffects =
    [];


for (
    const recordKey
    of BRIDGE_RECORDS
) {

    const record =
        getUniqueRecord(
            globalMap,
            recordKey
        );


    if (
        !record
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


    const modifier =
        parsePrimaryModifier(
            record.recordText
        );


    bridgeEffects.push(
        {
            recordKey,

            found:
                true,

            resourcePath:
                record.resourcePath,

            collectionMethod:
                captureScalarField(
                    record.recordText,
                    'm_eCollectionMethod'
                ),

            pickupExpiration:
                parseScaledValueField(
                    record.recordText,
                    'm_flPickupExpirationDuration'
                ),

            modifier
        }
    );
}


// ============================================================
// EXACT REFERENCE TRACE
// ============================================================

const permanentReferenceTrace =
    [];


for (
    const targetKey
    of PERMANENT_RECORDS
) {

    permanentReferenceTrace.push(
        {
            targetKey,

            references:
                findExactRecordReferences({
                    records,
                    targetKey
                })
        }
    );
}


// ============================================================
// FAMILY-LEVEL SOURCE TRACE
//
// Also search for each base family identifier because some
// producer resources may choose level variants programmatically
// rather than reference every concrete record.
// ============================================================

const permanentFamilyReferenceTrace =
    [];


for (
    const family
    of PERMANENT_FAMILIES
) {

    permanentFamilyReferenceTrace.push(
        {
            family,

            references:
                findSubstringRecordReferences({
                    records,
                    token:
                        family,

                    excludeKeys:
                        new Set(
                            [
                                family,
                                `${family}_lv2`,
                                `${family}_lv3`
                            ]
                        )
                })
        }
    );
}


// ============================================================
// BRIDGE SOURCE TRACE
// ============================================================

const bridgeReferenceTrace =
    BRIDGE_RECORDS.map(
        targetKey => ({
            targetKey,

            references:
                findExactRecordReferences({
                    records,
                    targetKey
                })
        })
    );


// ============================================================
// URN / IDOL CORRECTION
// ============================================================

const urnIdolEvidence =
    [];


for (
    const recordKey
    of URN_IDOL_RECORDS
) {

    const record =
        getUniqueRecord(
            globalMap,
            recordKey
        );


    if (
        !record
    ) {

        urnIdolEvidence.push(
            {
                recordKey,

                found:
                    false,

                evidence:
                    []
            }
        );

        continue;
    }


    const evidence =
        extractEvidenceLines(
            record.recordText,
            [
                'urn',
                'idol_urn',
                'Soul.Urn',
                'IDOL'
            ]
        );


    urnIdolEvidence.push(
        {
            recordKey,

            found:
                true,

            resourcePath:
                record.resourcePath,

            evidence
        }
    );
}


const urnEvidenceCount =
    urnIdolEvidence.filter(
        row =>
            row.found
            &&
            row.evidence.length >
            0
    ).length;


const urnInterpretation =
    urnEvidenceCount >=
        2
        ? 'URN_RESOURCE_FAMILY_STRONGLY_SUPPORTED'
        : 'URN_RESOURCE_FAMILY_REQUIRES_MORE_EVIDENCE';


// ============================================================
// LION STATUE INSPECTION
// ============================================================

const lionStatueRecord =
    getUniqueRecord(
        globalMap,
        LION_STATUE_RECORD
    );


let lionStatueInspection =
    {
        found:
            false
    };


if (
    lionStatueRecord
) {

    const permanentRefs =
        PERMANENT_RECORDS.filter(
            key =>
                containsExactIdentifier(
                    lionStatueRecord.recordText,
                    key
                )
        );


    const smallGoldReferenced =
        containsExactIdentifier(
            lionStatueRecord.recordText,
            'small_gold_pickup'
        );


    lionStatueInspection =
        {
            found:
                true,

            resourcePath:
                lionStatueRecord.resourcePath,

            permanentPickupReferences:
                permanentRefs,

            smallGoldPickupReferenced:
                smallGoldReferenced,

            interpretation:
                permanentRefs.length >
                0
                    ? 'DIRECT_PERMANENT_PICKUP_REFERENCE_PRESENT'
                    : smallGoldReferenced
                        ? 'SMALL_GOLD_PICKUP_REFERENCE_PRESENT_NO_DIRECT_PERMANENT_BUFF_REFERENCE'
                        : 'NO_DIRECT_PICKUP_SOURCE_RESOLVED'
        };
}


// ============================================================
// SOURCE CANDIDATE SUMMARY
// ============================================================

const producerCandidates =
    new Map();


for (
    const trace
    of permanentReferenceTrace
) {

    for (
        const reference
        of trace.references
    ) {

        const key =
            `${reference.resourcePath}|${reference.recordKey}`;


        if (
            !producerCandidates.has(
                key
            )
        ) {

            producerCandidates.set(
                key,
                {
                    resourcePath:
                        reference.resourcePath,

                    recordKey:
                        reference.recordKey,

                    referencedPickups:
                        new Set()
                }
            );
        }


        producerCandidates.get(
            key
        ).referencedPickups.add(
            trace.targetKey
        );
    }
}


for (
    const trace
    of permanentFamilyReferenceTrace
) {

    for (
        const reference
        of trace.references
    ) {

        const key =
            `${reference.resourcePath}|${reference.recordKey}`;


        if (
            !producerCandidates.has(
                key
            )
        ) {

            producerCandidates.set(
                key,
                {
                    resourcePath:
                        reference.resourcePath,

                    recordKey:
                        reference.recordKey,

                    referencedPickups:
                        new Set()
                }
            );
        }


        producerCandidates.get(
            key
        ).referencedPickups.add(
            trace.family
        );
    }
}


const permanentProducerCandidates =
    [
        ...producerCandidates.values()
    ]
        .map(
            row => ({
                resourcePath:
                    row.resourcePath,

                recordKey:
                    row.recordKey,

                referencedPickups:
                    [
                        ...row.referencedPickups
                    ].sort()
            })
        )
        .sort(
            (
                a,
                b
            ) =>
                b.referencedPickups.length -
                a.referencedPickups.length
                ||
                a.recordKey.localeCompare(
                    b.recordKey
                )
        );


// ============================================================
// VALIDATION
// ============================================================

const permanentParsedCount =
    permanentEffects.filter(
        row =>
            row.found
            &&
            row.isPermanentPickup ===
            true
            &&
            row.modifier
            &&
            row.modifier.scriptValues.length >
            0
    ).length;


const bridgeParsedCount =
    bridgeEffects.filter(
        row =>
            row.found
            &&
            row.modifier
            &&
            row.modifier.scriptValues.length >
            0
    ).length;


const validationChecks =
    {
        script133Ready:
            check(
                script133.status,
                'WORLD_STAT_BUFF_RESOURCE_CATALOG_READY_FOR_INTERPRETATION',
                true
            ),


        allPermanentEffectsParsed:
            check(
                permanentParsedCount,
                PERMANENT_RECORDS.length,
                permanentParsedCount ===
                PERMANENT_RECORDS.length
            ),


        allBridgeEffectsParsed:
            check(
                bridgeParsedCount,
                BRIDGE_RECORDS.length,
                bridgeParsedCount ===
                BRIDGE_RECORDS.length
            ),


        permanentReferenceTraceCompleted:
            check(
                permanentReferenceTrace.length,
                PERMANENT_RECORDS.length,
                permanentReferenceTrace.length ===
                PERMANENT_RECORDS.length
            ),


        urnCorrectionEvidenceAvailable:
            check(
                urnEvidenceCount,
                '>=2',
                urnEvidenceCount >=
                2
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
        ? 'WORLD_STAT_BUFF_EFFECTS_AND_SOURCE_TRACE_READY'
        : 'WORLD_STAT_BUFF_EFFECTS_AND_SOURCE_TRACE_REQUIRES_DIAGNOSIS';


const nextStage =
    validationPass
        ? 'BUILD_CURRENT_PURCHASABLE_ITEM_STAT_CATALOG_AND_THEN_REPLAY_ITEM_OWNERSHIP_LIFECYCLE'
        : 'DIAGNOSE_ONLY_UNRESOLVED_WORLD_BUFF_EFFECT_OR_REFERENCE_FIELDS';


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

        permanent:
            {
                effects:
                    permanentEffects,

                familyTables:
                    permanentFamilyTables,

                exactReferenceTrace:
                    permanentReferenceTrace,

                familyReferenceTrace:
                    permanentFamilyReferenceTrace,

                producerCandidates:
                    permanentProducerCandidates
            },

        bridgePowerups:
            {
                effects:
                    bridgeEffects,

                referenceTrace:
                    bridgeReferenceTrace
            },

        urnIdolCorrection:
            {
                interpretation:
                    urnInterpretation,

                evidence:
                    urnIdolEvidence
            },

        lionStatueInspection,

        interpretation:
            {
                permanentPickupSemantics:
                    'm_bIsPermanentPickup plus modifier_permanent_pickup and explicit modifier-value rows constitute strong local-resource evidence for permanent stat effects.',

                bridgeSemantics:
                    'Bridge Powerups are represented by temporary pickup records with dedicated modifier classes and script-value effects.',

                sourceTrace:
                    'Exact VData references identify resource-level producers/parents but do not prove replay-time acquisition.',

                urnCorrection:
                    'Golden-idol naming is not treated as Golden-Statue evidence when the underlying resource carries explicit Urn identifiers.',

                lionStatue:
                    'The lion-statue record is not assumed to grant permanent stats unless a direct permanent-pickup reference is found.',

                laterReplayLayer:
                    'PlayerState(t) requires replay reconstruction of which player actually acquired each effect and when.'
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
    'PERMANENT PICKUP EFFECT TABLE'
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
        of family.rows
    ) {

        const effects =
            row.scriptValues
                .map(
                    value =>
                        `${value.modifierValue}=${formatStructuredValue(value.value)}`
                )
                .join(
                    ', '
                );


        console.log(
            `  tier=${row.tier} ${effects}`
        );
    }


    console.log('');
}


// ============================================================
// BRIDGE TABLE
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'BRIDGE POWERUP EFFECT TABLE'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const row
    of bridgeEffects
) {

    console.log(
        row.recordKey
    );


    if (
        !row.found
        ||
        !row.modifier
    ) {

        console.log(
            '  UNRESOLVED'
        );

        console.log('');

        continue;
    }


    console.log(
        `  modifierClass=${row.modifier.modifierClass}`
    );


    for (
        const effect
        of row.modifier.scriptValues
    ) {

        console.log(
            `  ${effect.modifierValue.padEnd(58)} ` +
            `${formatStructuredValue(effect.value)}`
        );


        const extraKeys =
            Object.keys(
                effect.rawFields
            )
                .filter(
                    key =>
                        ![
                            'm_eModifierValue',
                            'm_value'
                        ].includes(
                            key
                        )
                );


        for (
            const key
            of extraKeys
        ) {

            console.log(
                `    ${key}=${formatStructuredValue(effect.rawFields[key])}`
            );
        }
    }


    if (
        row.modifier.timingFields.length >
        0
    ) {

        console.log(
            '  timing fields:'
        );


        for (
            const timing
            of row.modifier.timingFields
        ) {

            console.log(
                `    ${timing.key}=${formatStructuredValue(timing.value)}`
            );
        }
    }


    console.log('');
}


// ============================================================
// PRODUCER TRACE
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'PERMANENT PICKUP SOURCE / PARENT CANDIDATES'
);

console.log(
    '========================================================'
);

console.log('');


if (
    permanentProducerCandidates.length ===
    0
) {

    console.log(
        'NO EXTERNAL REFERENCES FOUND'
    );

} else {

    for (
        const row
        of permanentProducerCandidates
    ) {

        console.log(
            `${row.resourcePath.padEnd(30)} ` +
            `${row.recordKey.padEnd(55)} ` +
            `${row.referencedPickups.join(', ')}`
        );
    }
}


console.log('');


// ============================================================
// URN CORRECTION
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'URN / GOLDEN-IDOL INTERPRETATION CORRECTION'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    urnInterpretation
);


for (
    const row
    of urnIdolEvidence
) {

    console.log(
        `${row.recordKey}:`
    );


    for (
        const evidence
        of row.evidence.slice(
            0,
            12
        )
    ) {

        console.log(
            `  L${evidence.lineNumber}: ${evidence.text}`
        );
    }
}


console.log('');


// ============================================================
// LION STATUE
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'LION STATUE INSPECTION'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    JSON.stringify(
        lionStatueInspection,
        null,
        2
    )
);

console.log('');


// ============================================================
// VALIDATION
// ============================================================

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
        `${name.padEnd(44)} ${row.pass} ` +
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
// PRIMARY MODIFIER PARSER
// ============================================================

function parsePrimaryModifier(
    recordText
) {

    const block =
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
        !block
    ) {

        return null;
    }


    const flat =
        parseFlatScalarMap(
            block.inner
        );


    const modifierClass =
        flat._class
        ??
        flat._my_subclass_name
        ??
        null;


    const scriptValues =
        parseScriptValues(
            block.inner
        );


    const scalarAssignments =
        extractScalarAssignments(
            block.inner
        );


    const timingFields =
        scalarAssignments
            .filter(
                row =>
                    /duration|lifetime|expire|expiration|time/i.test(
                        row.key
                    )
            )
            .filter(
                row =>
                    ![
                        'm_eModifierValue'
                    ].includes(
                        row.key
                    )
            );


    return {
        modifierClass,

        scriptValues,

        timingFields
    };
}


// ============================================================
// SCRIPT VALUE PARSER
// ============================================================

function parseScriptValues(
    text
) {

    const container =
        extractNamedContainer(
            text,
            'm_vecScriptValues'
        );


    if (
        !container
    ) {

        // Fallback for resources with one inline value rather
        // than an explicit vector.
        const flat =
            parseFlatScalarMap(
                text
            );


        if (
            flat.m_eModifierValue
            &&
            Object.prototype.hasOwnProperty.call(
                flat,
                'm_value'
            )
        ) {

            return [
                {
                    modifierValue:
                        String(
                            flat.m_eModifierValue
                        ),

                    value:
                        flat.m_value,

                    rawFields:
                        flat
                }
            ];
        }


        return [];
    }


    let bodies =
        [];


    if (
        container.type ===
        'array'
    ) {

        bodies =
            extractObjectBodies(
                container.inner
            );

    } else {

        bodies =
            [
                container.inner
            ];
    }


    const rows =
        [];


    for (
        const body
        of bodies
    ) {

        const entries =
            parseTopLevelEntries(
                body
            );


        const rawFields =
            {};


        for (
            const entry
            of entries
        ) {

            if (
                entry.type ===
                'scalar'
            ) {

                rawFields[
                    entry.key
                ] =
                    parseScalar(
                        entry.rawValue
                    );

                continue;
            }


            rawFields[
                entry.key
            ] =
                summarizeContainerValue(
                    entry
                );
        }


        const modifierValue =
            rawFields.m_eModifierValue
            ??
            rawFields.eModifierValue
            ??
            null;


        const value =
            Object.prototype.hasOwnProperty.call(
                rawFields,
                'm_value'
            )
                ? rawFields.m_value
                : null;


        if (
            modifierValue ===
            null
            &&
            value ===
            null
        ) {

            continue;
        }


        rows.push(
            {
                modifierValue:
                    modifierValue !==
                    null
                        ? String(
                            modifierValue
                        )
                        : 'UNRESOLVED',

                value,

                rawFields
            }
        );
    }


    return rows;
}


// ============================================================
// STRUCTURED VALUE
// ============================================================

function summarizeContainerValue(
    entry
) {

    if (
        entry.type ===
        'object'
    ) {

        const flat =
            parseFlatScalarMap(
                entry.inner
            );


        if (
            Object.keys(
                flat
            ).length >
            0
        ) {

            return flat;
        }


        return {
            raw:
                entry.inner.trim()
        };
    }


    if (
        entry.type ===
        'array'
    ) {

        return {
            rawArray:
                entry.inner.trim()
        };
    }


    return null;
}


// ============================================================
// NAMED CONTAINER
// ============================================================

function extractNamedContainer(
    text,
    fieldName
) {

    const escaped =
        escapeRegex(
            fieldName
        );


    const arrayMatch =
        new RegExp(
            `${escaped}\\s*=\\s*\\[`,
            'm'
        ).exec(
            text
        );


    if (
        arrayMatch
    ) {

        const open =
            text.indexOf(
                '[',
                arrayMatch.index
            );


        const close =
            findMatchingDelimiter(
                text,
                open,
                '[',
                ']'
            );


        if (
            close !==
            null
        ) {

            return {
                type:
                    'array',

                inner:
                    text.slice(
                        open +
                        1,
                        close
                    )
            };
        }
    }


    const objectMatch =
        new RegExp(
            `${escaped}\\s*=\\s*(?:subclass:\\s*)?\\{`,
            'm'
        ).exec(
            text
        );


    if (
        objectMatch
    ) {

        const open =
            text.indexOf(
                '{',
                objectMatch.index
            );


        const close =
            findMatchingDelimiter(
                text,
                open,
                '{',
                '}'
            );


        if (
            close !==
            null
        ) {

            return {
                type:
                    'object',

                inner:
                    text.slice(
                        open +
                        1,
                        close
                    )
            };
        }
    }


    return null;
}


// ============================================================
// NAMED OBJECT FIELD
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
// SCALED FIELD PARSER
// ============================================================

function parseScaledValueField(
    text,
    fieldName
) {

    const object =
        extractNamedObjectField(
            text,
            fieldName
        );


    if (
        object
    ) {

        return parseFlatScalarMap(
            object.inner
        );
    }


    const scalar =
        captureScalarField(
            text,
            fieldName
        );


    return scalar;
}


// ============================================================
// SCALAR FIELD
// ============================================================

function captureScalarField(
    text,
    fieldName
) {

    const regex =
        new RegExp(
            `^\\s*${escapeRegex(fieldName)}\\s*=\\s*(.+?)\\s*,?\\s*$`,
            'm'
        );


    const match =
        regex.exec(
            text
        );


    if (
        !match
    ) {

        return null;
    }


    const raw =
        match[
            1
        ].trim();


    if (
        raw ===
        '{'
        ||
        raw ===
        '['
        ||
        raw ===
        'subclass:'
    ) {

        return null;
    }


    return parseScalar(
        raw
    );
}


// ============================================================
// PERMANENT FAMILY/TIER
// ============================================================

function resolvePermanentFamily(
    recordKey
) {

    for (
        const family
        of PERMANENT_FAMILIES
    ) {

        if (
            recordKey ===
            family
            ||
            recordKey ===
            `${family}_lv2`
            ||
            recordKey ===
            `${family}_lv3`
        ) {

            return family;
        }
    }


    return null;
}


function resolvePermanentTier(
    recordKey
) {

    if (
        recordKey.endsWith(
            '_lv3'
        )
    ) {

        return 3;
    }


    if (
        recordKey.endsWith(
            '_lv2'
        )
    ) {

        return 2;
    }


    return 1;
}


// ============================================================
// EXACT REFERENCES
// ============================================================

function findExactRecordReferences({
    records,
    targetKey
}) {

    const rows =
        [];


    for (
        const record
        of records
    ) {

        if (
            record.recordKey ===
            targetKey
        ) {

            continue;
        }


        if (
            !containsExactIdentifier(
                record.recordText,
                targetKey
            )
        ) {

            continue;
        }


        rows.push(
            {
                resourcePath:
                    record.resourcePath,

                recordKey:
                    record.recordKey,

                evidence:
                    extractEvidenceLines(
                        record.recordText,
                        [
                            targetKey
                        ]
                    )
            }
        );
    }


    return rows;
}


function findSubstringRecordReferences({
    records,
    token,
    excludeKeys
}) {

    const rows =
        [];


    for (
        const record
        of records
    ) {

        if (
            excludeKeys.has(
                record.recordKey
            )
        ) {

            continue;
        }


        if (
            !record.recordText.includes(
                token
            )
        ) {

            continue;
        }


        rows.push(
            {
                resourcePath:
                    record.resourcePath,

                recordKey:
                    record.recordKey,

                evidence:
                    extractEvidenceLines(
                        record.recordText,
                        [
                            token
                        ]
                    )
            }
        );
    }


    return rows;
}


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
// EVIDENCE LINES
// ============================================================

function extractEvidenceLines(
    text,
    terms
) {

    const lines =
        text.split(
            /\r?\n/
        );


    const output =
        [];


    for (
        let index =
            0;

        index <
            lines.length;

        index++
    ) {

        const lower =
            lines[
                index
            ].toLowerCase();


        if (
            !terms.some(
                term =>
                    lower.includes(
                        String(
                            term
                        ).toLowerCase()
                    )
            )
        ) {

            continue;
        }


        output.push(
            {
                lineNumber:
                    index +
                    1,

                text:
                    lines[
                        index
                    ].trim()
            }
        );


        if (
            output.length >=
            20
        ) {

            break;
        }
    }


    return output;
}


// ============================================================
// UNIQUE RECORD
// ============================================================

function getUniqueRecord(
    map,
    key
) {

    const rows =
        map.get(
            key
        )
        ??
        [];


    if (
        rows.length ===
        0
    ) {

        return null;
    }


    if (
        rows.length >
        1
    ) {

        console.log(
            `WARNING duplicate record key ${key}: ${rows.length} matches`
        );
    }


    return rows[
        0
    ];
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
// TOP LEVEL PARSER
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
// EXTRACT OBJECT BODIES
// ============================================================

function extractObjectBodies(
    text
) {

    const output =
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


        output.push(
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


    return output;
}


// ============================================================
// SCALAR ASSIGNMENTS
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

        const match =
            lines[
                index
            ].match(
                /^\s*"?([A-Za-z0-9_:.\/\-]+)"?\s*=\s*(.+?)\s*,?\s*$/
            );


        if (
            !match
        ) {

            continue;
        }


        const raw =
            match[
                2
            ].trim();


        if (
            raw ===
            '{'
            ||
            raw ===
            '['
            ||
            raw ===
            'subclass:'
            ||
            raw.endsWith(
                '{'
            )
            ||
            raw.endsWith(
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
                        raw
                    )
            }
        );
    }


    return rows;
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
// WHITESPACE + KEY
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
// SCALAR
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
// FORMAT
// ============================================================

function formatStructuredValue(
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


    if (
        typeof value ===
        'object'
    ) {

        return JSON.stringify(
            value
        );
    }


    return String(
        value
    );
}


// ============================================================
// HELPERS
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