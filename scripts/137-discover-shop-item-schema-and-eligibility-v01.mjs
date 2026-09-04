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
    'SHOP_ITEM_SCHEMA_AND_ELIGIBILITY_DISCOVERY_V01';


// ============================================================
// PURPOSE
//
// Script132 found ~272 structurally item-like records in
// abilities.vdata, but that cohort may contain:
//
//   - real purchasable items
//   - tier/base templates
//   - inheritance parents
//   - test/debug items
//   - disabled/development items
//   - other internal item-like records
//
// Therefore we do NOT yet freeze a "current item catalog".
//
// Script137 establishes the resource substrate required to do so.
//
// QUESTIONS:
//
// 1. What fields define:
//
//      category / slot
//      tier
//      cost
//      purchaseability
//      shop visibility
//      disabled/development state
//      test/deprecated state
//
// 2. How much item metadata is inherited through `_base`?
//
// 3. What direct always-on stats are represented through
//    m_mapAbilityProperties / m_eProvidedPropertyType?
//
// 4. What additional MODIFIER_VALUE_* tokens occur elsewhere in
//    the record, potentially representing conditional/passive/
//    active effects?
//
// 5. What fields encode:
//
//      upgrades
//      components
//      parent/child relations
//      prerequisites
//
// IMPORTANT:
//
// This is DISCOVERY.
//
// It does NOT yet decide that every candidate is purchasable.
//
// It does NOT yet calculate effective item stats.
//
// It does NOT parse a replay.
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


const WORLD_BUFF_CONTRACT_PATH =
    resolve(
        'output',
        'cross_replay',
        'world_stat_buff_resource_contract_v02.json'
    );


const RESOURCE_PATH =
    'scripts/abilities.vdata_c';


const OUTPUT_JSON_PATH =
    resolve(
        'output',
        'cross_replay',
        'shop_item_schema_and_eligibility_discovery_v01.json'
    );


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
// META FIELD DISCOVERY TERMS
//
// Recall-oriented.
//
// These names are not assumed to have final semantics merely
// because they match one of these terms.
// ============================================================

const META_FIELD_REGEX =
    /(item|shop|purch|cost|price|tier|slot|disabled|develop|hidden|hide|test|debug|deprecated|available|unlock|require|prereq|upgrade|component|parent|child|base)/i;


const RELATION_FIELD_REGEX =
    /(upgrade|component|parent|child|base|require|prereq|from|into)/i;


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
        WORLD_BUFF_CONTRACT_PATH
    )
) {

    throw new Error(
        [
            'Missing world-buff contract:',
            WORLD_BUFF_CONTRACT_PATH
        ].join(
            '\n'
        )
    );
}


const worldBuffContract =
    JSON.parse(
        readFileSync(
            WORLD_BUFF_CONTRACT_PATH,
            'utf8'
        )
    );


if (
    worldBuffContract?.status !==
    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY'
) {

    throw new Error(
        `World-buff contract not ready. Status=${worldBuffContract?.status}`
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
    'SHOP ITEM SCHEMA + ELIGIBILITY DISCOVERY V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'World-buff foundation: READY'
);

console.log(
    `Deadlock VPK:          ${pakPath}`
);

console.log(
    `Resource:              ${RESOURCE_PATH}`
);

console.log(
    'Replay parsing:        NONE'
);

console.log(
    'Current-item claim:    NOT YET'
);

console.log(
    'Output:                ONE JSON'
);

console.log('');


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-shop-item-schema-'
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


    const allRecords =
        [];


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


        allRecords.push(
            {
                recordKey:
                    entry.key,

                recordText:
                    entry.inner
            }
        );
    }


    console.log(
        `Top-level object records: ${allRecords.length}`
    );

    console.log(
        `Resource bytes:           ${resourceBuffer.length}`
    );

    console.log(
        `Resource SHA256:          ${resourceSha256}`
    );

    console.log('');


    // ========================================================
    // ANALYZE RECORDS
    // ========================================================

    const analyzedRecords =
        allRecords.map(
            analyzeRecord
        );


    // ========================================================
    // ITEM CANDIDATES
    // ========================================================

    const itemCandidates =
        analyzedRecords.filter(
            row =>
                row.itemCandidate
        );


    // ========================================================
    // CATEGORY / TIER / COST SUMMARY
    // ========================================================

    const slotCounts =
        countBy(
            itemCandidates,
            row =>
                String(
                    row.coreMetadata.itemSlot
                    ??
                    'UNRESOLVED'
                )
        );


    const tierCounts =
        countBy(
            itemCandidates,
            row =>
                String(
                    row.coreMetadata.itemTier
                    ??
                    'UNRESOLVED'
                )
        );


    const costCounts =
        countBy(
            itemCandidates,
            row =>
                String(
                    row.coreMetadata.itemCost
                    ??
                    'UNRESOLVED'
                )
        );


    // ========================================================
    // META FIELD SCHEMA
    //
    // Discover candidate shop/purchase/eligibility fields from
    // scalar assignments across all item-like records.
    // ========================================================

    const metaFieldMap =
        new Map();


    for (
        const item
        of itemCandidates
    ) {

        for (
            const [
                fieldName,
                value
            ]
            of Object.entries(
                item.topLevelScalars
            )
        ) {

            if (
                !META_FIELD_REGEX.test(
                    fieldName
                )
            ) {

                continue;
            }


            if (
                !metaFieldMap.has(
                    fieldName
                )
            ) {

                metaFieldMap.set(
                    fieldName,
                    {
                        recordKeys:
                            new Set(),

                        values:
                            new Map(),

                        examples:
                            []
                    }
                );
            }


            const target =
                metaFieldMap.get(
                    fieldName
                );


            target.recordKeys.add(
                item.recordKey
            );


            const valueKey =
                stableValue(
                    value
                );


            target.values.set(
                valueKey,
                (
                    target.values.get(
                        valueKey
                    )
                    ??
                    0
                )
                +
                1
            );


            if (
                target.examples.length <
                20
            ) {

                target.examples.push(
                    {
                        recordKey:
                            item.recordKey,

                        value
                    }
                );
            }
        }
    }


    const metaFieldSchema =
        [
            ...metaFieldMap.entries()
        ]
            .map(
                ([
                    fieldName,
                    row
                ]) => ({
                    fieldName,

                    recordCount:
                        row.recordKeys.size,

                    uniqueValueCount:
                        row.values.size,

                    values:
                        Object.fromEntries(
                            [
                                ...row.values.entries()
                            ]
                                .sort(
                                    (
                                        a,
                                        b
                                    ) =>
                                        b[1] -
                                        a[1]
                                )
                        ),

                    examples:
                        row.examples
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.recordCount -
                    a.recordCount
                    ||
                    a.fieldName.localeCompare(
                        b.fieldName
                    )
            );


    // ========================================================
    // RECURSIVE RELATION FIELD SCHEMA
    //
    // This scans all assignment names in the full record,
    // including nested structures.
    // ========================================================

    const relationFieldMap =
        new Map();


    for (
        const item
        of itemCandidates
    ) {

        for (
            const fieldName
            of item.relationFieldNames
        ) {

            if (
                !relationFieldMap.has(
                    fieldName
                )
            ) {

                relationFieldMap.set(
                    fieldName,
                    {
                        recordKeys:
                            new Set(),

                        examples:
                            []
                    }
                );
            }


            const target =
                relationFieldMap.get(
                    fieldName
                );


            target.recordKeys.add(
                item.recordKey
            );


            if (
                target.examples.length <
                20
            ) {

                target.examples.push(
                    item.recordKey
                );
            }
        }
    }


    const relationFieldSchema =
        [
            ...relationFieldMap.entries()
        ]
            .map(
                ([
                    fieldName,
                    row
                ]) => ({
                    fieldName,

                    recordCount:
                        row.recordKeys.size,

                    examples:
                        row.examples
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.recordCount -
                    a.recordCount
                    ||
                    a.fieldName.localeCompare(
                        b.fieldName
                    )
            );


    // ========================================================
    // DIRECT PROVIDED STAT SUBSTRATE
    // ========================================================

    const providedStatMap =
        new Map();


    let directPropertyRowCount =
        0;


    for (
        const item
        of itemCandidates
    ) {

        for (
            const property
            of item.abilityProperties
        ) {

            if (
                !property.providedPropertyType
            ) {

                continue;
            }


            directPropertyRowCount++;


            const token =
                String(
                    property.providedPropertyType
                );


            if (
                !providedStatMap.has(
                    token
                )
            ) {

                providedStatMap.set(
                    token,
                    {
                        itemKeys:
                            new Set(),

                        propertyKeys:
                            new Set(),

                        values:
                            new Map(),

                        examples:
                            []
                    }
                );
            }


            const target =
                providedStatMap.get(
                    token
                );


            target.itemKeys.add(
                item.recordKey
            );


            target.propertyKeys.add(
                property.propertyKey
            );


            const valueKey =
                stableValue(
                    property.value
                );


            target.values.set(
                valueKey,
                (
                    target.values.get(
                        valueKey
                    )
                    ??
                    0
                )
                +
                1
            );


            if (
                target.examples.length <
                20
            ) {

                target.examples.push(
                    {
                        recordKey:
                            item.recordKey,

                        propertyKey:
                            property.propertyKey,

                        value:
                            property.value
                    }
                );
            }
        }
    }


    const directProvidedStatSchema =
        [
            ...providedStatMap.entries()
        ]
            .map(
                ([
                    providedPropertyType,
                    row
                ]) => ({
                    providedPropertyType,

                    itemCount:
                        row.itemKeys.size,

                    propertyKeys:
                        [
                            ...row.propertyKeys
                        ].sort(),

                    uniqueValueCount:
                        row.values.size,

                    examples:
                        row.examples
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.itemCount -
                    a.itemCount
                    ||
                    a.providedPropertyType.localeCompare(
                        b.providedPropertyType
                    )
            );


    // ========================================================
    // RECORD-WIDE MODIFIER TOKEN UNIVERSE
    //
    // This includes conditional / active / passive effects, not
    // merely always-on provided properties.
    // ========================================================

    const modifierTokenMap =
        new Map();


    for (
        const item
        of itemCandidates
    ) {

        for (
            const token
            of item.modifierValueTokens
        ) {

            if (
                !modifierTokenMap.has(
                    token
                )
            ) {

                modifierTokenMap.set(
                    token,
                    {
                        itemKeys:
                            new Set(),

                        examples:
                            []
                    }
                );
            }


            const target =
                modifierTokenMap.get(
                    token
                );


            target.itemKeys.add(
                item.recordKey
            );


            if (
                target.examples.length <
                20
            ) {

                target.examples.push(
                    item.recordKey
                );
            }
        }
    }


    const recordModifierTokenSchema =
        [
            ...modifierTokenMap.entries()
        ]
            .map(
                ([
                    modifierValue,
                    row
                ]) => ({
                    modifierValue,

                    itemCount:
                        row.itemKeys.size,

                    examples:
                        row.examples
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.itemCount -
                    a.itemCount
                    ||
                    a.modifierValue.localeCompare(
                        b.modifierValue
                    )
            );


    // ========================================================
    // BASE / INHERITANCE SUMMARY
    // ========================================================

    const baseCounts =
        countBy(
            itemCandidates,
            row =>
                String(
                    row.coreMetadata.base
                    ??
                    'NO_BASE'
                )
        );


    const itemsWithBase =
        itemCandidates.filter(
            row =>
                row.coreMetadata.base !==
                null
        ).length;


    // ========================================================
    // STRUCTURAL SUBCOHORTS
    //
    // These are descriptive only.
    // ========================================================

    const candidatesWithSlot =
        itemCandidates.filter(
            row =>
                row.coreMetadata.itemSlot !==
                null
        );


    const candidatesWithTier =
        itemCandidates.filter(
            row =>
                row.coreMetadata.itemTier !==
                null
        );


    const candidatesWithCost =
        itemCandidates.filter(
            row =>
                row.coreMetadata.itemCost !==
                null
        );


    const candidatesWithSlotTierCost =
        itemCandidates.filter(
            row =>
                row.coreMetadata.itemSlot !==
                null
                &&
                row.coreMetadata.itemTier !==
                null
                &&
                row.coreMetadata.itemCost !==
                null
        );


    const candidateReasonCounts =
        countByMany(
            itemCandidates,
            row =>
                row.itemCandidateReasons
        );


    // ========================================================
    // POSSIBLE TEST / TEMPLATE NAME SIGNALS
    //
    // Diagnostic only.
    // Never used to exclude records.
    // ========================================================

    const nameSignalRows =
        itemCandidates
            .filter(
                row =>
                    /(test|debug|template|dummy|example|prototype|tier_[0-9]+$)/i.test(
                        row.recordKey
                    )
            )
            .map(
                row => ({
                    recordKey:
                        row.recordKey,

                    itemSlot:
                        row.coreMetadata.itemSlot,

                    itemTier:
                        row.coreMetadata.itemTier,

                    itemCost:
                        row.coreMetadata.itemCost,

                    base:
                        row.coreMetadata.base
                })
            );


    // ========================================================
    // VALIDATION
    // ========================================================

    const validationChecks =
        {
            worldBuffFoundationReady:
                check(
                    worldBuffContract.status,
                    'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY',
                    true
                ),


            abilitiesRecordsParsed:
                check(
                    allRecords.length,
                    '>500',
                    allRecords.length >
                    500
                ),


            itemCandidatesFound:
                check(
                    itemCandidates.length,
                    '>100',
                    itemCandidates.length >
                    100
                ),


            itemSlotValuesFound:
                check(
                    Object.keys(
                        slotCounts
                    ).length,
                    '>=3',
                    Object.keys(
                        slotCounts
                    ).length >=
                    3
                ),


            itemTierValuesFound:
                check(
                    Object.keys(
                        tierCounts
                    ).length,
                    '>1',
                    Object.keys(
                        tierCounts
                    ).length >
                    1
                ),


            directProvidedStatsFound:
                check(
                    directProvidedStatSchema.length,
                    '>0',
                    directProvidedStatSchema.length >
                    0
                ),


            metaFieldSchemaFound:
                check(
                    metaFieldSchema.length,
                    '>0',
                    metaFieldSchema.length >
                    0
                ),


            modifierTokensFound:
                check(
                    recordModifierTokenSchema.length,
                    '>0',
                    recordModifierTokenSchema.length >
                    0
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
            ? 'SHOP_ITEM_SCHEMA_AND_ELIGIBILITY_SUBSTRATE_READY'
            : 'SHOP_ITEM_SCHEMA_AND_ELIGIBILITY_SUBSTRATE_REQUIRES_DIAGNOSIS';


    const nextStage =
        validationPass
            ? 'INTERPRET_PURCHASEABILITY_FIELDS_AND_INHERITANCE_THEN_FREEZE_CURRENT_PURCHASABLE_ITEM_CATALOG'
            : 'DIAGNOSE_ITEM_CANDIDATE_OR_METADATA_SCHEMA';


    // ========================================================
    // OUTPUT
    // ========================================================

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
                        'LOCAL_INSTALLED_ABILITIES_VDATA',

                    pakPath,

                    resourcePath:
                        RESOURCE_PATH,

                    resourceBytes:
                        resourceBuffer.length,

                    resourceSha256
                },

            counts:
                {
                    topLevelObjectRecords:
                        allRecords.length,

                    itemCandidates:
                        itemCandidates.length,

                    candidatesWithSlot:
                        candidatesWithSlot.length,

                    candidatesWithTier:
                        candidatesWithTier.length,

                    candidatesWithCost:
                        candidatesWithCost.length,

                    candidatesWithSlotTierCost:
                        candidatesWithSlotTierCost.length,

                    candidatesWithBase:
                        itemsWithBase,

                    directProvidedPropertyRows:
                        directPropertyRowCount,

                    directProvidedStatTypes:
                        directProvidedStatSchema.length,

                    recordWideModifierValueTypes:
                        recordModifierTokenSchema.length,

                    metaFields:
                        metaFieldSchema.length,

                    relationFields:
                        relationFieldSchema.length,

                    diagnosticNameSignals:
                        nameSignalRows.length
                },

            candidateReasonCounts,

            coreMetadataSummary:
                {
                    slotCounts,

                    tierCounts,

                    costCounts,

                    baseCounts
                },

            metaFieldSchema,

            relationFieldSchema,

            directProvidedStatSchema,

            recordModifierTokenSchema,

            diagnosticNameSignals:
                nameSignalRows,

            candidates:
                itemCandidates,

            interpretation:
                {
                    candidateMeaning:
                        'Item candidates are a broad structural cohort and are not yet equivalent to the current purchasable shop catalog.',

                    directProperties:
                        'm_mapAbilityProperties entries with m_eProvidedPropertyType are treated as candidate direct/always-on item stat substrate.',

                    modifierTokens:
                        'Record-wide MODIFIER_VALUE_* tokens may include conditional, passive, triggered, active or internal effects and are not assumed continuously active.',

                    inheritance:
                        'The `_base` field is preserved because effective metadata/stat definitions may depend on inheritance.',

                    purchaseability:
                        'Purchaseability and shop visibility will be resolved from the discovered field schema rather than inferred from record names alone.',

                    nameSignals:
                        'Test/template-like record-name matches are diagnostic only and do not exclude records.'
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
        'ITEM CANDIDATE COUNTS'
    );

    console.log(
        '========================================================'
    );

    console.log('');

    console.log(
        `all records:                ${allRecords.length}`
    );

    console.log(
        `item candidates:            ${itemCandidates.length}`
    );

    console.log(
        `with slot:                  ${candidatesWithSlot.length}`
    );

    console.log(
        `with tier:                  ${candidatesWithTier.length}`
    );

    console.log(
        `with cost:                  ${candidatesWithCost.length}`
    );

    console.log(
        `with slot+tier+cost:        ${candidatesWithSlotTierCost.length}`
    );

    console.log(
        `with _base:                 ${itemsWithBase}`
    );

    console.log('');

    console.log(
        `candidate reasons: ${JSON.stringify(candidateReasonCounts)}`
    );

    console.log('');


    // ========================================================
    // SLOT / TIER / COST
    // ========================================================

    console.log(
        'CATEGORY / TIER / COST SUBSTRATE'
    );

    console.log(
        '------------------------------'
    );

    console.log(
        `slotCounts=${JSON.stringify(slotCounts)}`
    );

    console.log(
        `tierCounts=${JSON.stringify(tierCounts)}`
    );

    console.log(
        `costCounts=${JSON.stringify(costCounts)}`
    );

    console.log('');


    // ========================================================
    // META FIELD SCHEMA
    // ========================================================

    console.log(
        'SHOP / PURCHASE / ELIGIBILITY META FIELD SCHEMA'
    );

    console.log(
        '-----------------------------------------------'
    );


    for (
        const row
        of metaFieldSchema
    ) {

        const valuePreview =
            Object.entries(
                row.values
            )
                .slice(
                    0,
                    8
                )
                .map(
                    ([
                        value,
                        count
                    ]) =>
                        `${value}:${count}`
                )
                .join(
                    ', '
                );


        console.log(
            `${row.fieldName.padEnd(52)} ` +
            `records=${String(row.recordCount).padStart(4)} ` +
            `unique=${String(row.uniqueValueCount).padStart(3)} ` +
            `${valuePreview}`
        );
    }


    console.log('');


    // ========================================================
    // RELATION FIELDS
    // ========================================================

    console.log(
        'UPGRADE / COMPONENT / INHERITANCE FIELD SCHEMA'
    );

    console.log(
        '----------------------------------------------'
    );


    for (
        const row
        of relationFieldSchema
    ) {

        console.log(
            `${row.fieldName.padEnd(58)} ` +
            `records=${String(row.recordCount).padStart(4)}`
        );
    }


    console.log('');


    // ========================================================
    // DIRECT PROVIDED STATS
    // ========================================================

    console.log(
        'DIRECT PROVIDED STAT SUBSTRATE'
    );

    console.log(
        '------------------------------'
    );


    for (
        const row
        of directProvidedStatSchema
    ) {

        console.log(
            `${row.providedPropertyType.padEnd(62)} ` +
            `items=${String(row.itemCount).padStart(4)} ` +
            `propertyKeys=${row.propertyKeys.slice(0, 5).join(',')}`
        );
    }


    console.log('');


    // ========================================================
    // RECORD MODIFIER TOKENS
    // ========================================================

    console.log(
        'RECORD-WIDE ITEM MODIFIER TOKEN SUBSTRATE'
    );

    console.log(
        '-----------------------------------------'
    );


    for (
        const row
        of recordModifierTokenSchema.slice(
            0,
            120
        )
    ) {

        console.log(
            `${row.modifierValue.padEnd(62)} ` +
            `items=${String(row.itemCount).padStart(4)}`
        );
    }


    if (
        recordModifierTokenSchema.length >
        120
    ) {

        console.log(
            `... ${recordModifierTokenSchema.length - 120} additional tokens in JSON`
        );
    }


    console.log('');


    // ========================================================
    // NAME SIGNALS
    // ========================================================

    console.log(
        'TEST / TEMPLATE-LIKE NAME SIGNALS'
    );

    console.log(
        '---------------------------------'
    );


    if (
        nameSignalRows.length ===
        0
    ) {

        console.log(
            'NONE'
        );

    } else {

        for (
            const row
            of nameSignalRows.slice(
                0,
                80
            )
        ) {

            console.log(
                `${row.recordKey.padEnd(55)} ` +
                `slot=${String(row.itemSlot ?? 'n/a').padEnd(24)} ` +
                `tier=${String(row.itemTier ?? 'n/a').padEnd(8)} ` +
                `cost=${String(row.itemCost ?? 'n/a')}`
            );
        }
    }


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
// RECORD ANALYSIS
// ============================================================

function analyzeRecord(
    record
) {

    const topLevelScalars =
        parseFlatScalarMap(
            record.recordText
        );


    const itemSlot =
        firstPresent(
            topLevelScalars,
            [
                'm_eItemSlotType',
                'm_eItemSlot',
                'm_ItemSlotType'
            ]
        );


    const itemTier =
        firstPresent(
            topLevelScalars,
            [
                'm_iItemTier',
                'm_nItemTier',
                'm_iTier'
            ]
        );


    const itemCost =
        firstPresent(
            topLevelScalars,
            [
                'm_iCost',
                'm_nCost',
                'm_iGoldCost'
            ]
        );


    const abilityType =
        firstPresent(
            topLevelScalars,
            [
                'm_eAbilityType'
            ]
        );


    const sourceName =
        firstPresent(
            topLevelScalars,
            [
                'm_strAG2SourceName'
            ]
        );


    const base =
        firstPresent(
            topLevelScalars,
            [
                '_base'
            ]
        );


    const candidateReasons =
        [];


    if (
        itemSlot !==
        null
    ) {

        candidateReasons.push(
            'ITEM_SLOT_FIELD'
        );
    }


    if (
        itemTier !==
        null
    ) {

        candidateReasons.push(
            'ITEM_TIER_FIELD'
        );
    }


    if (
        abilityType ===
        'EAbilityType_Item'
    ) {

        candidateReasons.push(
            'ABILITY_TYPE_ITEM'
        );
    }


    if (
        String(
            sourceName
            ??
            ''
        ).toLowerCase() ===
        'item'
    ) {

        candidateReasons.push(
            'AG2_SOURCE_ITEM'
        );
    }


    if (
        /^upgrade_/i.test(
            record.recordKey
        )
    ) {

        candidateReasons.push(
            'UPGRADE_RECORD_KEY'
        );
    }


    const itemCandidate =
        candidateReasons.length >
        0;


    const abilityProperties =
        parseAbilityProperties(
            record.recordText
        );


    const modifierValueTokens =
        uniqueMatches(
            record.recordText,
            /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g
        );


    const relationFieldNames =
        extractAssignmentFieldNames(
            record.recordText
        )
            .filter(
                fieldName =>
                    RELATION_FIELD_REGEX.test(
                        fieldName
                    )
            );


    return {
        recordKey:
            record.recordKey,

        itemCandidate,

        itemCandidateReasons:
            candidateReasons,

        coreMetadata:
            {
                itemSlot,

                itemTier:

                    finiteOrScalar(
                        itemTier
                    ),

                itemCost:
                    finiteOrScalar(
                        itemCost
                    ),

                abilityType,

                sourceName,

                base
            },

        topLevelScalars,

        abilityProperties,

        modifierValueTokens,

        relationFieldNames
    };
}


// ============================================================
// ABILITY PROPERTY PARSER
// ============================================================

function parseAbilityProperties(
    recordText
) {

    const block =
        extractNamedObjectField(
            recordText,
            'm_mapAbilityProperties'
        );


    if (
        !block
    ) {

        return [];
    }


    const rows =
        [];


    for (
        const entry
        of parseTopLevelEntries(
            block.inner
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

                negativeAttribute:
                    firstPresent(
                        flat,
                        [
                            'm_bIsNegativeAttribute'
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
// FIELD NAME INVENTORY
// ============================================================

function extractAssignmentFieldNames(
    text
) {

    const output =
        new Set();


    for (
        const line
        of text.split(
            /\r?\n/
        )
    ) {

        const match =
            line.match(
                /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=/
            );


        if (
            match
        ) {

            output.add(
                match[
                    1
                ]
            );
        }
    }


    return [
        ...output
    ].sort();
}


// ============================================================
// COUNT HELPERS
// ============================================================

function countBy(
    rows,
    selector
) {

    const map =
        new Map();


    for (
        const row
        of rows
    ) {

        const key =
            selector(
                row
            );


        map.set(
            key,
            (
                map.get(
                    key
                )
                ??
                0
            )
            +
            1
        );
    }


    return Object.fromEntries(
        [
            ...map.entries()
        ]
            .sort(
                (
                    a,
                    b
                ) =>
                    b[1] -
                    a[1]
                    ||
                    String(
                        a[0]
                    ).localeCompare(
                        String(
                            b[0]
                        )
                    )
            )
    );
}


function countByMany(
    rows,
    selector
) {

    const map =
        new Map();


    for (
        const row
        of rows
    ) {

        for (
            const key
            of selector(
                row
            )
        ) {

            map.set(
                key,
                (
                    map.get(
                        key
                    )
                    ??
                    0
                )
                +
                1
            );
        }
    }


    return Object.fromEntries(
        [
            ...map.entries()
        ]
            .sort(
                (
                    a,
                    b
                ) =>
                    b[1] -
                    a[1]
            )
    );
}


// ============================================================
// STABLE VALUE
// ============================================================

function stableValue(
    value
) {

    if (
        value ===
        undefined
    ) {

        return 'undefined';
    }


    return JSON.stringify(
        value
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
// FIRST PRESENT
// ============================================================

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


// ============================================================
// UNIQUE MATCHES
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


// ============================================================
// NUMERIC
// ============================================================

function finiteOrScalar(
    value
) {

    const number =
        Number(
            value
        );


    return Number.isFinite(
        number
    )
        ? number
        : value;
}


// ============================================================
// CHECK
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