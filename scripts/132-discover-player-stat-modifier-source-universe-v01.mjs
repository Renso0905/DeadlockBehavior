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
    statSync,
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
    'PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_DISCOVERY_V01';


// ============================================================
// PURPOSE
//
// Scripts131 V01/V02 established:
//
//   HERO INTRINSICS
//   STANDARD BOON / LEVEL SCALING
//   SPECIAL HERO CROSS-STAT SCALING
//   CATEGORY GOLD-THRESHOLD PROGRESSION
//
// This script discovers the NEXT layer:
//
//   WHAT ELSE CAN MODIFY PLAYER STATS?
//
// Candidate source classes:
//
//   SHOP_ITEM_CANDIDATE
//   HERO_BOUND_ABILITY
//   PERMANENT_WORLD_BUFF_CANDIDATE
//   TEMPORARY_POWERUP_CANDIDATE
//   OBJECTIVE_STATE_CANDIDATE
//   OTHER_BUFF_DEBUFF_CANDIDATE
//   OTHER_MODIFIER_BEARING_RECORD
//
// It also discovers the STAT IDENTIFIER UNIVERSE:
//
//   MODIFIER_VALUE_*
//   provided property types
//   scale-function stat types
//
// Important:
//
// This is RESOURCE DISCOVERY.
//
// A resource containing a modifier property does NOT establish:
//
//   - when it is active
//   - whether it stacks
//   - whether it is additive or multiplicative
//   - whether it applies to the owner, ally, or enemy
//   - whether it is permanent
//   - whether replay telemetry exposes its active state
//
// Those questions come later.
//
// No replay parsing.
// No effective-stat calculation.
// No opportunity classification.
// ============================================================


// ============================================================
// INPUTS
// ============================================================

const SOURCE2VIEWER_PATH =
    resolve(
        'tools',
        'source2viewer',
        'Source2Viewer-CLI.exe'
    );


const SCRIPT131_V01_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_stat_progression_schema_discovery_v01.json'
    );


const SCRIPT131_V02_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_stat_progression_schema_discovery_v02.json'
    );


const HERO_MAP_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_id_display_name_map_v05.json'
    );


// ============================================================
// OUTPUTS
// ============================================================

const OUTPUT_JSON_PATH =
    resolve(
        'output',
        'cross_replay',
        'player_stat_modifier_source_universe_discovery_v01.json'
    );


const OUTPUT_MARKDOWN_PATH =
    resolve(
        'output',
        'cross_replay',
        'player_stat_modifier_source_universe_discovery_v01.md'
    );


// ============================================================
// LOCAL RESOURCE CANDIDATES
//
// Missing optional resources are tolerated.
//
// abilities.vdata is expected to carry the majority of item /
// ability property definitions.
//
// misc.vdata is important for world objects such as breakables.
//
// generic_data and npc_units are included as additional discovery
// surfaces rather than assumed mechanic authorities.
// ============================================================

const RESOURCE_PATHS =
    [
        'scripts/abilities.vdata_c',
        'scripts/misc.vdata_c',
        'scripts/generic_data.vdata_c',
        'scripts/npc_units.vdata_c'
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
// KEYWORD GROUPS
//
// These are DISCOVERY aids only.
//
// Matching one of these does not assign final mechanic semantics.
// ============================================================

const KEYWORD_GROUPS =
    {
        permanentWorld:
            [
                'statue',
                'golden',
                'permanent',
                'sinner',
                'sacrifice',
                'goose',
                'egg'
            ],

        powerup:
            [
                'powerup',
                'power_up'
            ],

        objective:
            [
                'urn',
                'midboss',
                'mid_boss',
                'rejuvenator',
                'rejuvenation',
                'rejuv'
            ],

        genericBuffDebuff:
            [
                'buff',
                'debuff',
                'aura',
                'slow',
                'haste'
            ]
    };


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


for (
    const requiredPath
    of [
        SCRIPT131_V01_PATH,
        SCRIPT131_V02_PATH,
        HERO_MAP_PATH
    ]
) {

    if (
        !existsSync(
            requiredPath
        )
    ) {

        throw new Error(
            `Missing required input:\n${requiredPath}`
        );
    }
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
// LOAD FOUNDATION
// ============================================================

const statV01 =
    JSON.parse(
        readFileSync(
            SCRIPT131_V01_PATH,
            'utf8'
        )
    );


const statV02 =
    JSON.parse(
        readFileSync(
            SCRIPT131_V02_PATH,
            'utf8'
        )
    );


const heroMap =
    JSON.parse(
        readFileSync(
            HERO_MAP_PATH,
            'utf8'
        )
    );


if (
    statV01?.status !==
    'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION'
) {

    throw new Error(
        `Script131 V01 not ready. Status=${statV01?.status}`
    );
}


if (
    statV02?.status !==
    'HERO_CATEGORY_GOLD_THRESHOLD_PROGRESSION_SCHEMA_READY'
) {

    throw new Error(
        `Script131 V02 not ready. Status=${statV02?.status}`
    );
}


if (
    heroMap?.status !==
    'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY'
) {

    throw new Error(
        `Hero map not ready. Status=${heroMap?.status}`
    );
}


// ============================================================
// BUILD HERO-BOUND ABILITY REFERENCE SET
//
// Script131 V01 already retained m_mapBoundAbilities.
//
// We preserve raw strings and normalized identifiers so that
// abilities.vdata records can be classified as hero-bound without
// guessing from their names.
// ============================================================

const heroBoundReferenceRows =
    [];


for (
    const hero
    of statV01.heroes
    ??
    []
) {

    const boundAbilities =
        hero.boundAbilities
        ??
        {};


    for (
        const [
            slot,
            value
        ]
        of Object.entries(
            boundAbilities
        )
    ) {

        const strings =
            collectStrings(
                value
            );


        for (
            const rawValue
            of strings
        ) {

            heroBoundReferenceRows.push(
                {
                    heroId:
                        hero.heroId,

                    displayName:
                        hero.displayName,

                    slot,

                    rawValue,

                    normalizedIdentifiers:
                        extractIdentifiers(
                            rawValue
                        )
                }
            );
        }
    }
}


const heroAbilityIdentifierMap =
    new Map();


for (
    const row
    of heroBoundReferenceRows
) {

    for (
        const identifier
        of row.normalizedIdentifiers
    ) {

        if (
            !heroAbilityIdentifierMap.has(
                identifier
            )
        ) {

            heroAbilityIdentifierMap.set(
                identifier,
                []
            );
        }


        heroAbilityIdentifierMap.get(
            identifier
        ).push(
            {
                heroId:
                    row.heroId,

                displayName:
                    row.displayName,

                slot:
                    row.slot,

                rawValue:
                    row.rawValue
            }
        );
    }
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
    '========================================================'
);

console.log(
    'PLAYER STAT MODIFIER SOURCE UNIVERSE DISCOVERY V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'Hero/stat foundation: Scripts131 V01 + V02'
);

console.log(
    `Deadlock VPK:        ${pakPath}`
);

console.log(
    'Replay parsing:      NONE'
);

console.log(
    'Effective stats:     NOT CALCULATED'
);

console.log(
    'Semantics:           CANDIDATE DISCOVERY ONLY'
);

console.log('');


// ============================================================
// TEMPORARY EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-stat-modifier-universe-'
        )
    );


const extractedResources =
    [];


// ============================================================
// EXTRACT RESOURCES
// ============================================================

console.log(
    'Extracting resource candidates...'
);


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
        result.success
    ) {

        extractedResources.push(
            result
        );


        console.log(
            `  PASS ${resourcePath} bytes=${result.bytes}`
        );

    } else {

        console.log(
            `  MISS ${resourcePath}`
        );
    }
}


console.log('');


// ============================================================
// ANALYZE TOP-LEVEL RECORDS
// ============================================================

const records =
    [];


for (
    const resource
    of extractedResources
) {

    const text =
        readFileSync(
            resource.localPath,
            'utf8'
        );


    const rootInner =
        extractRootInner(
            text
        );


    const entries =
        parseTopLevelEntries(
            rootInner
        );


    console.log(
        `${resource.resourcePath}: top-level records=${entries.length}`
    );


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


        records.push(
            analyzeRecord({
                resourcePath:
                    resource.resourcePath,

                recordKey:
                    entry.key,

                recordText:
                    entry.inner
            })
        );
    }
}


console.log('');


// ============================================================
// CLASSIFICATION GROUPS
// ============================================================

const modifierBearingRecords =
    records.filter(
        row =>
            row.modifierBearing
    );


const shopItemCandidates =
    records.filter(
        row =>
            row.sourceClass ===
            'SHOP_ITEM_CANDIDATE'
    );


const heroAbilityCandidates =
    records.filter(
        row =>
            row.sourceClass ===
            'HERO_BOUND_ABILITY'
    );


const permanentWorldCandidates =
    records.filter(
        row =>
            row.sourceClass ===
            'PERMANENT_WORLD_BUFF_CANDIDATE'
    );


const powerupCandidates =
    records.filter(
        row =>
            row.sourceClass ===
            'TEMPORARY_POWERUP_CANDIDATE'
    );


const objectiveCandidates =
    records.filter(
        row =>
            row.sourceClass ===
            'OBJECTIVE_STATE_CANDIDATE'
    );


const otherBuffDebuffCandidates =
    records.filter(
        row =>
            row.sourceClass ===
            'OTHER_BUFF_DEBUFF_CANDIDATE'
    );


const otherModifierRecords =
    records.filter(
        row =>
            row.sourceClass ===
            'OTHER_MODIFIER_BEARING_RECORD'
    );


// ============================================================
// STAT TOKEN UNIVERSE
// ============================================================

const statTokenMap =
    new Map();


for (
    const record
    of modifierBearingRecords
) {

    const tokens =
        [
            ...record.modifierValueTokens,
            ...record.providedPropertyTypes,
            ...record.scalingStatTokens
        ];


    for (
        const token
        of tokens
    ) {

        if (
            !token
        ) {

            continue;
        }


        if (
            !statTokenMap.has(
                token
            )
        ) {

            statTokenMap.set(
                token,
                {
                    token,

                    records:
                        new Set(),

                    sourceClasses:
                        new Map(),

                    resources:
                        new Map(),

                    examples:
                        []
                }
            );
        }


        const target =
            statTokenMap.get(
                token
            );


        target.records.add(
            `${record.resourcePath}|${record.recordKey}`
        );


        increment(
            target.sourceClasses,
            record.sourceClass
        );


        increment(
            target.resources,
            record.resourcePath
        );


        if (
            target.examples.length <
            12
        ) {

            target.examples.push(
                {
                    resourcePath:
                        record.resourcePath,

                    recordKey:
                        record.recordKey,

                    sourceClass:
                        record.sourceClass
                }
            );
        }
    }
}


const statTokenUniverse =
    [
        ...statTokenMap.values()
    ]
        .map(
            row => ({
                token:
                    row.token,

                recordCount:
                    row.records.size,

                sourceClasses:
                    Object.fromEntries(
                        [
                            ...row.sourceClasses.entries()
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

                resources:
                    Object.fromEntries(
                        [
                            ...row.resources.entries()
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
                a.token.localeCompare(
                    b.token
                )
        );


// ============================================================
// ABILITY PROPERTY KEY UNIVERSE
//
// Property keys are useful even when m_eProvidedPropertyType is
// absent because many mechanics are represented by semantically
// meaningful property names.
// ============================================================

const propertyKeyCounts =
    new Map();


for (
    const record
    of records
) {

    for (
        const property
        of record.abilityProperties
    ) {

        increment(
            propertyKeyCounts,
            property.propertyKey
        );
    }
}


const abilityPropertyKeyUniverse =
    [
        ...propertyKeyCounts.entries()
    ]
        .map(
            ([
                propertyKey,
                count
            ]) => ({
                propertyKey,
                count
            })
        )
        .sort(
            (
                a,
                b
            ) =>
                b.count -
                a.count
                ||
                a.propertyKey.localeCompare(
                    b.propertyKey
                )
        );


// ============================================================
// SOURCE CLASS COUNTS
// ============================================================

const sourceClassCounts =
    countBy(
        records,
        row =>
            row.sourceClass
    );


// ============================================================
// ITEM SLOT / TIER SUMMARY
// ============================================================

const itemSlotCounts =
    countBy(
        shopItemCandidates,
        row =>
            row.itemHints.itemSlot
            ??
            'UNRESOLVED'
    );


const itemTierCounts =
    countBy(
        shopItemCandidates,
        row =>
            row.itemHints.itemTier
            ??
            'UNRESOLVED'
    );


// ============================================================
// HIGH-VALUE WORLD KEYWORD EVIDENCE
// ============================================================

const specialKeywordCandidates =
    records
        .filter(
            row =>
                row.keywordMatches.length >
                0
        )
        .sort(
            (
                a,
                b
            ) =>
                sourcePriority(
                    a.sourceClass
                )
                -
                sourcePriority(
                    b.sourceClass
                )
                ||
                a.recordKey.localeCompare(
                    b.recordKey
                )
        );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
    {
        progressionFoundationReady:
            check(
                statV02.status,
                'HERO_CATEGORY_GOLD_THRESHOLD_PROGRESSION_SCHEMA_READY',
                true
            ),


        abilitiesResourceExtracted:
            check(
                extractedResources.some(
                    row =>
                        row.resourcePath ===
                        'scripts/abilities.vdata_c'
                ),
                true,
                extractedResources.some(
                    row =>
                        row.resourcePath ===
                        'scripts/abilities.vdata_c'
                )
            ),


        topLevelRecordsParsed:
            check(
                records.length,
                '>0',
                records.length >
                0
            ),


        modifierBearingRecordsFound:
            check(
                modifierBearingRecords.length,
                '>0',
                modifierBearingRecords.length >
                0
            ),


        abilityPropertyKeysFound:
            check(
                abilityPropertyKeyUniverse.length,
                '>0',
                abilityPropertyKeyUniverse.length >
                0
            ),


        statTokensFound:
            check(
                statTokenUniverse.length,
                '>0',
                statTokenUniverse.length >
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


// ============================================================
// STATUS
// ============================================================

const status =
    validationPass
        ? 'PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_READY_FOR_INTERPRETATION'
        : 'PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_REQUIRES_DIAGNOSIS';


const nextStage =
    validationPass
        ? 'INSPECT_SOURCE_CLASSES_THEN_BUILD_EXPLICIT_ITEM_WORLD_BUFF_POWERUP_AND_ACTIVE_EFFECT_CATALOGS'
        : 'DIAGNOSE_RESOURCE_OR_PROPERTY_DISCOVERY';


// ============================================================
// SUMMARY
// ============================================================

const summary =
    {
        version:
            VERSION,

        canonical:
            false,

        createdAt:
            new Date().toISOString(),

        status,

        foundation:
            {
                intrinsicHeroStats:
                    SCRIPT131_V01_PATH,

                categoryGoldThresholdProgression:
                    SCRIPT131_V02_PATH
            },

        source:
            {
                method:
                    'LOCAL_INSTALLED_DEADLOCK_VDATA_DISCOVERY',

                pakPath,

                pakBytes:
                    statSync(
                        pakPath
                    ).size,

                source2ViewerPath:
                    SOURCE2VIEWER_PATH,

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
                    ),

                temporaryResourcesDeleted:
                    true
            },

        counts:
            {
                topLevelRecords:
                    records.length,

                modifierBearingRecords:
                    modifierBearingRecords.length,

                shopItemCandidates:
                    shopItemCandidates.length,

                heroBoundAbilities:
                    heroAbilityCandidates.length,

                permanentWorldBuffCandidates:
                    permanentWorldCandidates.length,

                temporaryPowerupCandidates:
                    powerupCandidates.length,

                objectiveStateCandidates:
                    objectiveCandidates.length,

                otherBuffDebuffCandidates:
                    otherBuffDebuffCandidates.length,

                otherModifierBearingRecords:
                    otherModifierRecords.length,

                statTokens:
                    statTokenUniverse.length,

                abilityPropertyKeys:
                    abilityPropertyKeyUniverse.length
            },

        sourceClassCounts,

        itemSummary:
            {
                itemSlotCounts,

                itemTierCounts
            },

        statTokenUniverse,

        abilityPropertyKeyUniverse,

        shopItemCandidates,

        heroAbilityCandidates,

        permanentWorldCandidates,

        powerupCandidates,

        objectiveCandidates,

        otherBuffDebuffCandidates,

        otherModifierRecords,

        specialKeywordCandidates,

        records,

        interpretation:
            {
                candidateOnly:
                    'Source classes in this checkpoint are discovery classifications, not finalized gameplay semantics.',

                itemProperties:
                    'm_mapAbilityProperties is treated as a stat/modifier substrate. Individual property semantics and stacking order remain unresolved.',

                heroAbilities:
                    'Hero-bound ability classification is grounded in m_mapBoundAbilities from heroes.vdata rather than name guessing where possible.',

                permanentWorld:
                    'Statue/permanent/Sinner/Goose-related matches identify records for dedicated follow-up. Keyword presence alone does not prove permanent-stat application.',

                powerups:
                    'Powerup matches identify the bridge/world temporary-buff branch for dedicated follow-up.',

                objectives:
                    'Urn/Midboss/Rejuvenator matches are separated because objective state can alter player state but is conceptually distinct from owned items.',

                finalGoal:
                    'The eventual PlayerState(t) engine must combine hero intrinsic state, boon progression, category investment, owned items, permanent buffs, temporary buffs, ability/passive state, ally/enemy effects and objective state.'
            },

        validation:
            {
                pass:
                    validationPass,

                checks:
                    validationChecks
            },

        nextStage,

        outputs:
            {
                json:
                    OUTPUT_JSON_PATH,

                markdown:
                    OUTPUT_MARKDOWN_PATH
            }
    };


// ============================================================
// WRITE
// ============================================================

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
        summary,
        null,
        2
    ),
    'utf8'
);


writeFileSync(
    OUTPUT_MARKDOWN_PATH,
    buildMarkdown(
        summary
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
    'MODIFIER SOURCE CLASS COUNTS'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const [
        sourceClass,
        count
    ]
    of Object.entries(
        sourceClassCounts
    )
) {

    console.log(
        `${sourceClass.padEnd(42)} ${count}`
    );
}


console.log('');


// ============================================================
// ITEM SUBSTRATE
// ============================================================

console.log(
    'SHOP ITEM MODIFIER SUBSTRATE'
);

console.log(
    '----------------------------'
);

console.log(
    `candidates=${shopItemCandidates.length}`
);

console.log(
    `slotCounts=${JSON.stringify(itemSlotCounts)}`
);

console.log(
    `tierCounts=${JSON.stringify(itemTierCounts)}`
);

console.log('');


// ============================================================
// HERO ABILITY SUBSTRATE
// ============================================================

console.log(
    'HERO-BOUND ABILITY / PASSIVE SUBSTRATE'
);

console.log(
    '--------------------------------------'
);

console.log(
    `candidates=${heroAbilityCandidates.length}`
);


for (
    const row
    of heroAbilityCandidates.slice(
        0,
        40
    )
) {

    const heroText =
        row.heroAssociations
            .map(
                hero =>
                    `${hero.displayName}(${hero.heroId})`
            )
            .join(
                ','
            );


    console.log(
        `${row.recordKey.padEnd(48)} ` +
        `heroes=${heroText} ` +
        `properties=${row.abilityProperties.length}`
    );
}


console.log('');


// ============================================================
// WORLD / PERMANENT
// ============================================================

console.log(
    'PERMANENT WORLD-BUFF CANDIDATES'
);

console.log(
    '-------------------------------'
);


if (
    permanentWorldCandidates.length ===
    0
) {

    console.log(
        'NONE CLASSIFIED'
    );

} else {

    for (
        const row
        of permanentWorldCandidates
    ) {

        console.log(
            `${row.resourcePath.padEnd(28)} ` +
            `${row.recordKey.padEnd(55)} ` +
            `keywords=${row.keywordMatches.join(',')} ` +
            `properties=${row.abilityProperties.length}`
        );
    }
}


console.log('');


// ============================================================
// POWERUPS
// ============================================================

console.log(
    'TEMPORARY POWERUP CANDIDATES'
);

console.log(
    '----------------------------'
);


if (
    powerupCandidates.length ===
    0
) {

    console.log(
        'NONE CLASSIFIED'
    );

} else {

    for (
        const row
        of powerupCandidates
    ) {

        console.log(
            `${row.resourcePath.padEnd(28)} ` +
            `${row.recordKey.padEnd(55)} ` +
            `keywords=${row.keywordMatches.join(',')} ` +
            `properties=${row.abilityProperties.length}`
        );
    }
}


console.log('');


// ============================================================
// OBJECTIVES
// ============================================================

console.log(
    'OBJECTIVE-STATE MODIFIER CANDIDATES'
);

console.log(
    '-----------------------------------'
);


if (
    objectiveCandidates.length ===
    0
) {

    console.log(
        'NONE CLASSIFIED'
    );

} else {

    for (
        const row
        of objectiveCandidates
    ) {

        console.log(
            `${row.resourcePath.padEnd(28)} ` +
            `${row.recordKey.padEnd(55)} ` +
            `keywords=${row.keywordMatches.join(',')} ` +
            `properties=${row.abilityProperties.length}`
        );
    }
}


console.log('');


// ============================================================
// STAT TOKEN UNIVERSE
// ============================================================

console.log(
    'MODIFIABLE STAT TOKEN UNIVERSE'
);

console.log(
    '------------------------------'
);


for (
    const row
    of statTokenUniverse.slice(
        0,
        120
    )
) {

    console.log(
        `${row.token.padEnd(58)} ` +
        `records=${String(row.recordCount).padStart(4)}`
    );
}


if (
    statTokenUniverse.length >
    120
) {

    console.log(
        `... ${statTokenUniverse.length - 120} additional tokens in JSON`
    );
}


console.log('');


// ============================================================
// PROPERTY KEY UNIVERSE
// ============================================================

console.log(
    'ABILITY PROPERTY KEY UNIVERSE'
);

console.log(
    '-----------------------------'
);


for (
    const row
    of abilityPropertyKeyUniverse.slice(
        0,
        100
    )
) {

    console.log(
        `${row.propertyKey.padEnd(58)} ` +
        `records=${String(row.count).padStart(4)}`
    );
}


if (
    abilityPropertyKeyUniverse.length >
    100
) {

    console.log(
        `... ${abilityPropertyKeyUniverse.length - 100} additional property keys in JSON`
    );
}


console.log('');


// ============================================================
// SPECIAL KEYWORD CANDIDATES
// ============================================================

console.log(
    'SPECIAL WORLD / BUFF KEYWORD CANDIDATE SAMPLE'
);

console.log(
    '---------------------------------------------'
);


for (
    const row
    of specialKeywordCandidates.slice(
        0,
        80
    )
) {

    console.log(
        `${row.sourceClass.padEnd(38)} ` +
        `${row.resourcePath.padEnd(28)} ` +
        `${row.recordKey.padEnd(48)} ` +
        `${row.keywordMatches.join(',')}`
    );
}


if (
    specialKeywordCandidates.length >
    80
) {

    console.log(
        `... ${specialKeywordCandidates.length - 80} additional candidates in JSON`
    );
}


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

console.log(
    `Markdown:\n${OUTPUT_MARKDOWN_PATH}`
);

console.log('');


// ============================================================
// RECORD ANALYSIS
// ============================================================

function analyzeRecord({
    resourcePath,
    recordKey,
    recordText
}) {

    const lowerKey =
        recordKey.toLowerCase();


    const lowerText =
        recordText.toLowerCase();


    const combined =
        `${lowerKey}\n${lowerText}`;


    // --------------------------------------------------------
    // Ability properties
    // --------------------------------------------------------

    const propertiesBlock =
        extractBalancedFieldBlock(
            recordText,
            'm_mapAbilityProperties'
        );


    const abilityProperties =
        propertiesBlock
            ? parseAbilityProperties(
                propertiesBlock.inner
            )
            : [];


    // --------------------------------------------------------
    // Modifier tokens
    // --------------------------------------------------------

    const modifierValueTokens =
        uniqueMatches(
            recordText,
            /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g
        );


    const providedPropertyTypes =
        captureAssignedTokens(
            recordText,
            'm_eProvidedPropertyType'
        );


    const scalingStatTokens =
        [
            ...captureAssignedTokens(
                recordText,
                'm_eSpecificStatScaleType'
            ),

            ...captureVectorEnumTokens(
                recordText,
                'm_vecScalingStats'
            )
        ]
            .filter(
                Boolean
            )
            .filter(
                uniqueFilter
            );


    // --------------------------------------------------------
    // Item hints
    // --------------------------------------------------------

    const flat =
        parseFlatScalarMap(
            recordText
        );


    const itemSlot =
        firstPresent(
            flat,
            [
                'm_eItemSlotType',
                'm_eItemSlot',
                'm_ItemSlotType'
            ]
        );


    const itemTier =
        firstPresent(
            flat,
            [
                'm_iItemTier',
                'm_nItemTier',
                'm_iTier'
            ]
        );


    const itemCost =
        firstPresent(
            flat,
            [
                'm_iCost',
                'm_nCost',
                'm_iGoldCost'
            ]
        );


    const shopImage =
        firstPresent(
            flat,
            [
                'm_strShopImage',
                'm_strShopIcon',
                'm_strAbilityImage'
            ]
        );


    const itemHintCount =
        [
            itemSlot !==
            null,

            itemTier !==
            null,

            itemCost !==
            null,

            /m_strShopImage/i.test(
                recordText
            ),

            /m_eItemSlotType/i.test(
                recordText
            ),

            /^upgrade_/i.test(
                recordKey
            )
        ]
            .filter(
                Boolean
            ).length;


    const shopItemCandidate =
        itemHintCount >=
        1
        &&
        (
            /^upgrade_/i.test(
                recordKey
            )
            ||
            /m_eItemSlotType/i.test(
                recordText
            )
            ||
            /m_strShopImage/i.test(
                recordText
            )
        );


    // --------------------------------------------------------
    // Hero-bound ability relation
    // --------------------------------------------------------

    const heroAssociations =
        findHeroAssociations(
            recordKey
        );


    const heroBound =
        heroAssociations.length >
        0;


    // --------------------------------------------------------
    // Keyword matches
    // --------------------------------------------------------

    const permanentMatches =
        matchingKeywords(
            combined,
            KEYWORD_GROUPS.permanentWorld
        );


    const powerupMatches =
        matchingKeywords(
            combined,
            KEYWORD_GROUPS.powerup
        );


    const objectiveMatches =
        matchingKeywords(
            combined,
            KEYWORD_GROUPS.objective
        );


    const genericBuffMatches =
        matchingKeywords(
            combined,
            KEYWORD_GROUPS.genericBuffDebuff
        );


    const keywordMatches =
        [
            ...permanentMatches,
            ...powerupMatches,
            ...objectiveMatches,
            ...genericBuffMatches
        ]
            .filter(
                uniqueFilter
            );


    // --------------------------------------------------------
    // Other mechanic structures
    // --------------------------------------------------------

    const hasWeaponInfo =
        /m_WeaponInfo\s*=\s*\{/i.test(
            recordText
        );


    const hasModifierSubclass =
        /modifier/i.test(
            recordText
        )
        ||
        /modifier/i.test(
            recordKey
        );


    const modifierBearing =
        abilityProperties.length >
        0
        ||
        modifierValueTokens.length >
        0
        ||
        providedPropertyTypes.length >
        0
        ||
        scalingStatTokens.length >
        0
        ||
        hasModifierSubclass;


    // --------------------------------------------------------
    // Source class
    //
    // Hero/item classification gets priority over generic
    // "buff" words because item and hero abilities often contain
    // internal modifier/buff subclasses themselves.
    // --------------------------------------------------------

    let sourceClass;


    if (
        heroBound
    ) {

        sourceClass =
            'HERO_BOUND_ABILITY';

    } else if (
        shopItemCandidate
    ) {

        sourceClass =
            'SHOP_ITEM_CANDIDATE';

    } else if (
        permanentMatches.length >
        0
    ) {

        sourceClass =
            'PERMANENT_WORLD_BUFF_CANDIDATE';

    } else if (
        powerupMatches.length >
        0
    ) {

        sourceClass =
            'TEMPORARY_POWERUP_CANDIDATE';

    } else if (
        objectiveMatches.length >
        0
    ) {

        sourceClass =
            'OBJECTIVE_STATE_CANDIDATE';

    } else if (
        genericBuffMatches.length >
        0
    ) {

        sourceClass =
            'OTHER_BUFF_DEBUFF_CANDIDATE';

    } else if (
        modifierBearing
    ) {

        sourceClass =
            'OTHER_MODIFIER_BEARING_RECORD';

    } else {

        sourceClass =
            'NON_MODIFIER_RECORD';
    }


    return {
        resourcePath,

        recordKey,

        sourceClass,

        modifierBearing,

        heroAssociations,

        itemHints:
            {
                candidate:
                    shopItemCandidate,

                itemSlot,

                itemTier,

                itemCost,

                shopImage
            },

        keywordGroups:
            {
                permanentWorld:
                    permanentMatches,

                powerup:
                    powerupMatches,

                objective:
                    objectiveMatches,

                genericBuffDebuff:
                    genericBuffMatches
            },

        keywordMatches,

        structures:
            {
                abilityProperties:
                    Boolean(
                        propertiesBlock
                    ),

                weaponInfo:
                    hasWeaponInfo,

                modifierSubclass:
                    hasModifierSubclass
            },

        abilityProperties,

        modifierValueTokens,

        providedPropertyTypes,

        scalingStatTokens,

        evidenceSample:
            buildEvidenceSample(
                recordText,
                keywordMatches
            )
    };
}


// ============================================================
// ABILITY PROPERTY PARSER
// ============================================================

function parseAbilityProperties(
    block
) {

    const rows =
        [];


    const entries =
        parseTopLevelEntries(
            block
        );


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
                    ),

                scalingStatTokens:
                    [
                        ...captureAssignedTokens(
                            entry.inner,
                            'm_eSpecificStatScaleType'
                        ),

                        ...captureVectorEnumTokens(
                            entry.inner,
                            'm_vecScalingStats'
                        )
                    ]
                        .filter(
                            uniqueFilter
                        )
            }
        );
    }


    return rows;
}


// ============================================================
// HERO ASSOCIATION
// ============================================================

function findHeroAssociations(
    recordKey
) {

    const identifiers =
        extractIdentifiers(
            recordKey
        );


    const matches =
        [];


    const seen =
        new Set();


    for (
        const identifier
        of identifiers
    ) {

        const associations =
            heroAbilityIdentifierMap.get(
                identifier
            )
            ??
            [];


        for (
            const association
            of associations
        ) {

            const key =
                `${association.heroId}|${association.slot}|${association.rawValue}`;


            if (
                seen.has(
                    key
                )
            ) {

                continue;
            }


            seen.add(
                key
            );


            matches.push(
                association
            );
        }
    }


    // Fallback substring comparison for resource wrappers.
    if (
        matches.length ===
        0
    ) {

        const lowerRecord =
            recordKey.toLowerCase();


        for (
            const row
            of heroBoundReferenceRows
        ) {

            if (
                String(
                    row.rawValue
                )
                    .toLowerCase()
                    .includes(
                        lowerRecord
                    )
            ) {

                const key =
                    `${row.heroId}|${row.slot}|${row.rawValue}`;


                if (
                    seen.has(
                        key
                    )
                ) {

                    continue;
                }


                seen.add(
                    key
                );


                matches.push(
                    {
                        heroId:
                            row.heroId,

                        displayName:
                            row.displayName,

                        slot:
                            row.slot,

                        rawValue:
                            row.rawValue
                    }
                );
            }
        }
    }


    return matches;
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
        null;


    if (
        existsSync(
            desiredOutput
        )
    ) {

        localPath =
            desiredOutput;

    } else {

        localPath =
            findFileRecursive(
                temporaryDirectory,
                (
                    fileName,
                    path
                ) =>
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
// ROOT OBJECT
// ============================================================

function extractRootInner(
    text
) {

    const open =
        findNextUnquotedCharacter(
            text,
            '{',
            0
        );


    if (
        open ===
        null
    ) {

        return text;
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

        return text;
    }


    return text.slice(
        open +
        1,
        close
    );
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
// FLAT SCALAR MAP
// ============================================================

function parseFlatScalarMap(
    text
) {

    const result =
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


        result[
            row.key
        ] =
            parseScalar(
                row.rawValue
            );
    }


    return result;
}


// ============================================================
// ASSIGNED TOKEN EXTRACTION
// ============================================================

function captureAssignedTokens(
    text,
    fieldName
) {

    const output =
        [];


    const regex =
        new RegExp(
            `${escapeRegex(fieldName)}\\s*=\\s*([^\\r\\n]+)`,
            'g'
        );


    for (
        const match
        of text.matchAll(
            regex
        )
    ) {

        const value =
            parseScalar(
                match[
                    1
                ]
            );


        if (
            value ===
            null
            ||
            value ===
            undefined
        ) {

            continue;
        }


        output.push(
            String(
                value
            )
        );
    }


    return output.filter(
        uniqueFilter
    );
}


// ============================================================
// VECTOR ENUM TOKEN EXTRACTION
// ============================================================

function captureVectorEnumTokens(
    text,
    fieldName
) {

    const output =
        [];


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

        return output;
    }


    const open =
        text.indexOf(
            '[',
            match.index
        );


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

        return output;
    }


    const inner =
        text.slice(
            open +
            1,
            close
        );


    for (
        const tokenMatch
        of inner.matchAll(
            /\b(?:MODIFIER_VALUE_[A-Z0-9_]+|E[A-Za-z0-9_]+)\b/g
        )
    ) {

        output.push(
            tokenMatch[
                0
            ]
        );
    }


    return output.filter(
        uniqueFilter
    );
}


// ============================================================
// LOW-LEVEL DELIMITER PARSING
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
// DISCOVERY HELPERS
// ============================================================

function matchingKeywords(
    text,
    keywords
) {

    const lower =
        text.toLowerCase();


    return keywords.filter(
        keyword =>
            lower.includes(
                keyword.toLowerCase()
            )
    );
}


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


function collectStrings(
    value
) {

    const output =
        [];


    walk(
        value
    );


    return output;


    function walk(
        current
    ) {

        if (
            typeof current ===
            'string'
        ) {

            output.push(
                current
            );

            return;
        }


        if (
            Array.isArray(
                current
            )
        ) {

            for (
                const child
                of current
            ) {

                walk(
                    child
                );
            }


            return;
        }


        if (
            current
            &&
            typeof current ===
            'object'
        ) {

            for (
                const child
                of Object.values(
                    current
                )
            ) {

                walk(
                    child
                );
            }
        }
    }
}


function extractIdentifiers(
    value
) {

    const text =
        String(
            value
            ??
            ''
        )
            .toLowerCase()
            .replace(
                /\\/g,
                '/'
            );


    const output =
        new Set();


    // Whole string tokens.
    for (
        const match
        of text.matchAll(
            /[a-z0-9_]+/g
        )
    ) {

        if (
            match[
                0
            ].length >=
            3
        ) {

            output.add(
                match[
                    0
                ]
            );
        }
    }


    // Resource/path basename.
    const parts =
        text.split(
            '/'
        );


    const finalPart =
        parts[
            parts.length -
            1
        ]
        ??
        '';


    const basenameValue =
        finalPart
            .replace(
                /\.(?:vdata|vdata_c|vmdl|vpcf|vsnd_c)$/g,
                ''
            )
            .replace(
                /_c$/,
                ''
            );


    if (
        basenameValue.length >=
        3
    ) {

        output.add(
            basenameValue
        );
    }


    return [
        ...output
    ];
}


function buildEvidenceSample(
    text,
    keywords
) {

    if (
        keywords.length ===
        0
    ) {

        return [];
    }


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
            !keywords.some(
                keyword =>
                    lower.includes(
                        keyword.toLowerCase()
                    )
            )
        ) {

            continue;
        }


        output.push(
            {
                line:
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
            10
        ) {

            break;
        }
    }


    return output;
}


function sourcePriority(
    sourceClass
) {

    const order =
        {
            PERMANENT_WORLD_BUFF_CANDIDATE:
                0,

            TEMPORARY_POWERUP_CANDIDATE:
                1,

            OBJECTIVE_STATE_CANDIDATE:
                2,

            SHOP_ITEM_CANDIDATE:
                3,

            HERO_BOUND_ABILITY:
                4,

            OTHER_BUFF_DEBUFF_CANDIDATE:
                5,

            OTHER_MODIFIER_BEARING_RECORD:
                6,

            NON_MODIFIER_RECORD:
                7
        };


    return order[
        sourceClass
    ]
    ??
    99;
}


// ============================================================
// COLLECTION HELPERS
// ============================================================

function countBy(
    rows,
    selector
) {

    const counts =
        new Map();


    for (
        const row
        of rows
    ) {

        increment(
            counts,
            String(
                selector(
                    row
                )
            )
        );
    }


    return Object.fromEntries(
        [
            ...counts.entries()
        ]
            .sort(
                (
                    a,
                    b
                ) =>
                    b[1] -
                    a[1]
                    ||
                    a[0].localeCompare(
                        b[0]
                    )
            )
    );
}


function increment(
    map,
    key
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


function uniqueFilter(
    value,
    index,
    array
) {

    return array.indexOf(
        value
    ) ===
    index;
}


// ============================================================
// GENERIC HELPERS
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


// ============================================================
// MARKDOWN
// ============================================================

function buildMarkdown(
    summary
) {

    const lines =
        [];


    lines.push(
        '# Player Stat Modifier Source Universe Discovery V01'
    );

    lines.push('');

    lines.push(
        `Status: **${summary.status}**`
    );

    lines.push('');

    lines.push(
        '## Foundation'
    );

    lines.push('');

    lines.push(
        'Scripts131 V01/V02 already establish hero intrinsic stats, boon scaling, special cross-stat scaling, and category gold-threshold progression.'
    );

    lines.push('');

    lines.push(
        'This checkpoint inventories additional resource-level sources capable of modifying player state.'
    );

    lines.push('');

    lines.push(
        '## Source classes'
    );

    lines.push('');


    for (
        const [
            sourceClass,
            count
        ]
        of Object.entries(
            summary.sourceClassCounts
        )
    ) {

        lines.push(
            `- **${sourceClass}**: ${count}`
        );
    }


    lines.push('');

    lines.push(
        '## Counts'
    );

    lines.push('');

    lines.push(
        `- Shop item candidates: ${summary.counts.shopItemCandidates}`
    );

    lines.push(
        `- Hero-bound abilities: ${summary.counts.heroBoundAbilities}`
    );

    lines.push(
        `- Permanent world-buff candidates: ${summary.counts.permanentWorldBuffCandidates}`
    );

    lines.push(
        `- Temporary powerup candidates: ${summary.counts.temporaryPowerupCandidates}`
    );

    lines.push(
        `- Objective-state candidates: ${summary.counts.objectiveStateCandidates}`
    );

    lines.push(
        `- Modifiable stat tokens: ${summary.counts.statTokens}`
    );

    lines.push(
        `- Ability property keys: ${summary.counts.abilityPropertyKeys}`
    );

    lines.push('');

    lines.push(
        '## Guardrail'
    );

    lines.push('');

    lines.push(
        'These are candidate modifier sources. This checkpoint does not determine activation conditions, stacking order, targets, permanence, or replay observability.'
    );

    lines.push('');

    lines.push(
        '## Next stage'
    );

    lines.push('');

    lines.push(
        summary.nextStage
    );

    lines.push('');


    return lines.join(
        '\n'
    );
}