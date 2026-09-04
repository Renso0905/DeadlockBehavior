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
    'PLAYER_STAT_MODIFIER_SOURCE_UNIVERSE_DISCOVERY_V02';


// ============================================================
// PURPOSE
//
// Script132 V01 is WITHDRAWN.
//
// V01 extracted the correct VData resources but parsed zero
// top-level records from every file.
//
// Root cause:
//
// Source 2 KV3 text begins with a metadata header such as:
//
//   <!-- kv3
//        encoding:text:version{...}
//        format:generic:version{...}
//   -->
//   {
//       ...
//   }
//
// V01 searched for the first "{" in the file, which was inside
// the KV3 metadata header rather than the actual document root.
//
// V02:
//
//   1. explicitly skips the KV3 metadata header;
//
//   2. locates the actual root object;
//
//   3. validates that each large resource produces records;
//
//   4. inventories candidate player-stat modifier sources;
//
//   5. inventories modifiable stat tokens / property keys.
//
// FOUNDATION ALREADY ESTABLISHED:
//
//   Script131 V01:
//     hero starting stats
//     boon progression
//     special hero scaling
//
//   Script131 V02:
//     Weapon/Vitality/Spirit gold-investment breakpoints
//
// THIS SCRIPT DISCOVERS:
//
//   SHOP_ITEM_CANDIDATE
//   HERO_BOUND_ABILITY
//   PERMANENT_WORLD_BUFF_CANDIDATE
//   TEMPORARY_POWERUP_CANDIDATE
//   OBJECTIVE_STATE_CANDIDATE
//   OTHER_BUFF_DEBUFF_CANDIDATE
//   OTHER_MODIFIER_BEARING_RECORD
//
// IMPORTANT:
//
// These are candidate source classifications.
//
// This script does NOT determine:
//
//   - activation conditions
//   - stacking order
//   - additive vs multiplicative math
//   - duration
//   - owner/ally/enemy target
//   - replay observability
//   - effective PlayerState(t)
//
// No replay parsing.
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
        'player_stat_modifier_source_universe_discovery_v02.json'
    );


const OUTPUT_MARKDOWN_PATH =
    resolve(
        'output',
        'cross_replay',
        'player_stat_modifier_source_universe_discovery_v02.md'
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
// DISCOVERY KEYWORDS
//
// These are recall-oriented discovery terms.
// They do NOT assign final gameplay semantics.
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
// HERO-BOUND ABILITY REFERENCE SET
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
    'PLAYER STAT MODIFIER SOURCE UNIVERSE DISCOVERY V0.2'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'Script132 V01:      WITHDRAWN - KV3 root parser bug'
);

console.log(
    'Hero/stat base:     Scripts131 V01 + V02'
);

console.log(
    `Deadlock VPK:       ${pakPath}`
);

console.log(
    'Replay parsing:     NONE'
);

console.log(
    'Effective stats:    NOT CALCULATED'
);

console.log('');


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-stat-modifier-v02-'
        )
    );


const extractedResources =
    [];


// ============================================================
// EXTRACT
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
// PARSE RESOURCE ROOTS
// ============================================================

const records =
    [];


const resourceParseDiagnostics =
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


    const root =
        extractKv3Root(
            text
        );


    if (
        !root
    ) {

        resourceParseDiagnostics.push(
            {
                resourcePath:
                    resource.resourcePath,

                kv3HeaderPresent:
                    /<!--\s*kv3/i.test(
                        text
                    ),

                headerEndIndex:
                    text.indexOf(
                        '-->'
                    ),

                rootFound:
                    false,

                rootStart:
                    null,

                rootEnd:
                    null,

                topLevelRecords:
                    0,

                firstTopLevelKeys:
                    []
            }
        );


        console.log(
            `${resource.resourcePath}: ROOT NOT FOUND`
        );


        continue;
    }


    const entries =
        parseTopLevelEntries(
            root.inner
        );


    const objectEntries =
        entries.filter(
            entry =>
                entry.type ===
                'object'
        );


    resourceParseDiagnostics.push(
        {
            resourcePath:
                resource.resourcePath,

            kv3HeaderPresent:
                root.kv3HeaderPresent,

            headerEndIndex:
                root.headerEndIndex,

            rootFound:
                true,

            rootStart:
                root.rootStart,

            rootEnd:
                root.rootEnd,

            rootBytes:
                root.inner.length,

            topLevelEntries:
                entries.length,

            topLevelRecords:
                objectEntries.length,

            firstTopLevelKeys:
                entries
                    .slice(
                        0,
                        20
                    )
                    .map(
                        row =>
                            row.key
                    )
        }
    );


    console.log(
        `${resource.resourcePath}: ` +
        `entries=${entries.length} ` +
        `objectRecords=${objectEntries.length} ` +
        `headerSkipped=${root.kv3HeaderPresent}`
    );


    if (
        entries.length >
        0
    ) {

        console.log(
            `  first keys: ${entries
                .slice(
                    0,
                    8
                )
                .map(
                    row =>
                        row.key
                )
                .join(', ')}`
        );
    }


    for (
        const entry
        of objectEntries
    ) {

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
// MODIFIABLE STAT TOKEN UNIVERSE
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
            ...record.scalingStatTokens,

            ...record.abilityProperties.flatMap(
                property => [
                    ...property.modifierValueTokens,
                    ...property.scalingStatTokens,
                    property.providedPropertyType
                ]
            )
        ]
            .filter(
                Boolean
            );


    for (
        const token
        of tokens
    ) {

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
// SOURCE COUNTS
// ============================================================

const sourceClassCounts =
    countBy(
        records,
        row =>
            row.sourceClass
    );


// ============================================================
// ITEM SUMMARIES
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
// SPECIAL KEYWORD COHORT
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
// RESOURCE-LEVEL VALIDATION
// ============================================================

const abilitiesDiagnostic =
    resourceParseDiagnostics.find(
        row =>
            row.resourcePath ===
            'scripts/abilities.vdata_c'
    )
    ??
    null;


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


        kv3RootFoundForAbilities:
            check(
                abilitiesDiagnostic?.rootFound
                ??
                false,

                true,

                abilitiesDiagnostic?.rootFound ===
                true
            ),


        abilitiesTopLevelRecordsParsed:
            check(
                abilitiesDiagnostic?.topLevelRecords
                ??
                0,

                '>0',

                (
                    abilitiesDiagnostic?.topLevelRecords
                    ??
                    0
                ) >
                0
            ),


        allResourcesYieldSomeTopLevelEntries:
            check(
                resourceParseDiagnostics.filter(
                    row =>
                        (
                            row.topLevelEntries
                            ??
                            0
                        ) >
                        0
                ).length,

                resourceParseDiagnostics.length,

                resourceParseDiagnostics.length >
                0
                &&
                resourceParseDiagnostics.every(
                    row =>
                        (
                            row.topLevelEntries
                            ??
                            0
                        ) >
                        0
                )
            ),


        modifierBearingRecordsFound:
            check(
                modifierBearingRecords.length,
                '>0',
                modifierBearingRecords.length >
                0
            ),


        shopItemsFound:
            check(
                shopItemCandidates.length,
                '>0',
                shopItemCandidates.length >
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
        ? 'INSPECT_SOURCE_CLASSES_THEN_BUILD_EXPLICIT_ITEM_PERMANENT_BUFF_POWERUP_AND_ACTIVE_EFFECT_CATALOGS'
        : 'DIAGNOSE_ONLY_REMAINING_RESOURCE_CLASSIFICATION_OR_PROPERTY_GAPS';


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

        supersedes:
            {
                script:
                    'Script132 V01',

                reason:
                    'V01 selected a brace inside the KV3 metadata header instead of the document root, yielding zero parsed records.'
            },

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

        resourceParseDiagnostics,

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
                v01Withdrawn:
                    'All zero counts from Script132 V01 are invalid and must not be interpreted mechanically.',

                candidateOnly:
                    'The V02 source classes remain discovery classifications rather than finalized mechanic semantics.',

                items:
                    'Shop-item candidates are identified using item/resource fields such as item slot, tier, cost, shop imagery and item-style record names.',

                properties:
                    'm_mapAbilityProperties and MODIFIER_VALUE_* identifiers provide the resource substrate for discovering which statistics can be affected.',

                heroAbilities:
                    'Hero-bound classification uses hero ability references when available rather than relying solely on name matching.',

                worldBuffs:
                    'Permanent/world/powerup/objective groups remain candidate sets requiring dedicated mechanic validation.',

                finalGoal:
                    'PlayerState(t) will eventually derive effective stats from intrinsic hero state + boon progression + category investment + owned items + permanent buffs + temporary buffs + ability/passive state + external effects.'
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
// CONSOLE OUTPUT
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'KV3 ROOT / RESOURCE PARSE DIAGNOSTIC'
);

console.log(
    '========================================================'
);

console.log('');


for (
    const row
    of resourceParseDiagnostics
) {

    console.log(
        `${row.resourcePath}`
    );

    console.log(
        `  kv3HeaderPresent=${row.kv3HeaderPresent}`
    );

    console.log(
        `  headerEndIndex=${row.headerEndIndex}`
    );

    console.log(
        `  rootFound=${row.rootFound}`
    );

    console.log(
        `  rootStart=${row.rootStart}`
    );

    console.log(
        `  rootEnd=${row.rootEnd}`
    );

    console.log(
        `  topLevelEntries=${row.topLevelEntries ?? 0}`
    );

    console.log(
        `  objectRecords=${row.topLevelRecords ?? 0}`
    );

    console.log(
        `  firstKeys=${JSON.stringify(row.firstTopLevelKeys ?? [])}`
    );

    console.log('');
}


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
// ITEMS
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


for (
    const row
    of shopItemCandidates.slice(
        0,
        30
    )
) {

    console.log(
        `${row.recordKey.padEnd(52)} ` +
        `slot=${String(row.itemHints.itemSlot ?? 'n/a').padEnd(28)} ` +
        `tier=${String(row.itemHints.itemTier ?? 'n/a').padEnd(8)} ` +
        `properties=${row.abilityProperties.length}`
    );
}


console.log('');


// ============================================================
// HERO ABILITIES
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

    const associations =
        row.heroAssociations
            .map(
                hero =>
                    `${hero.displayName}(${hero.heroId})`
            )
            .join(
                ','
            );


    console.log(
        `${row.recordKey.padEnd(52)} ` +
        `heroes=${associations} ` +
        `properties=${row.abilityProperties.length}`
    );
}


console.log('');


// ============================================================
// PERMANENT WORLD
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
        of permanentWorldCandidates.slice(
            0,
            100
        )
    ) {

        console.log(
            `${row.resourcePath.padEnd(30)} ` +
            `${row.recordKey.padEnd(58)} ` +
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
        of powerupCandidates.slice(
            0,
            100
        )
    ) {

        console.log(
            `${row.resourcePath.padEnd(30)} ` +
            `${row.recordKey.padEnd(58)} ` +
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
        of objectiveCandidates.slice(
            0,
            100
        )
    ) {

        console.log(
            `${row.resourcePath.padEnd(30)} ` +
            `${row.recordKey.padEnd(58)} ` +
            `keywords=${row.keywordMatches.join(',')} ` +
            `properties=${row.abilityProperties.length}`
        );
    }
}


console.log('');


// ============================================================
// STAT TOKENS
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
        150
    )
) {

    console.log(
        `${row.token.padEnd(62)} ` +
        `records=${String(row.recordCount).padStart(4)}`
    );
}


if (
    statTokenUniverse.length >
    150
) {

    console.log(
        `... ${statTokenUniverse.length - 150} additional tokens in JSON`
    );
}


console.log('');


// ============================================================
// PROPERTY KEYS
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
        120
    )
) {

    console.log(
        `${row.propertyKey.padEnd(62)} ` +
        `records=${String(row.count).padStart(4)}`
    );
}


if (
    abilityPropertyKeyUniverse.length >
    120
) {

    console.log(
        `... ${abilityPropertyKeyUniverse.length - 120} additional property keys in JSON`
    );
}


console.log('');


// ============================================================
// SPECIAL KEYWORDS
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
        100
    )
) {

    console.log(
        `${row.sourceClass.padEnd(38)} ` +
        `${row.resourcePath.padEnd(30)} ` +
        `${row.recordKey.padEnd(52)} ` +
        `${row.keywordMatches.join(',')}`
    );
}


if (
    specialKeywordCandidates.length >
    100
) {

    console.log(
        `... ${specialKeywordCandidates.length - 100} additional rows in JSON`
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
        `${name.padEnd(46)} ${row.pass} ` +
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


    const abilityType =
        firstPresent(
            flat,
            [
                'm_eAbilityType'
            ]
        );


    const sourceName =
        firstPresent(
            flat,
            [
                'm_strAG2SourceName'
            ]
        );


    const shopItemCandidate =
        (
            itemTier !==
            null
            &&
            itemSlot !==
            null
        )
        ||
        (
            abilityType ===
            'EAbilityType_Item'
            &&
            itemTier !==
            null
        )
        ||
        (
            sourceName ===
            'item'
            &&
            itemTier !==
            null
        )
        ||
        (
            /^upgrade_/i.test(
                recordKey
            )
            &&
            itemTier !==
            null
        );


    const heroAssociations =
        findHeroAssociations(
            recordKey
        );


    const heroBound =
        heroAssociations.length >
        0;


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

                abilityType,

                sourceName
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

        scalingStatTokens
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
                            Boolean
                        )
                        .filter(
                            uniqueFilter
                        )
            }
        );
    }


    return rows;
}


// ============================================================
// HERO ASSOCIATIONS
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

            const signature =
                `${association.heroId}|${association.slot}|${association.rawValue}`;


            if (
                seen.has(
                    signature
                )
            ) {

                continue;
            }


            seen.add(
                signature
            );


            matches.push(
                association
            );
        }
    }


    return matches;
}


// ============================================================
// KV3 ROOT FIX
// ============================================================

function extractKv3Root(
    text
) {

    const kv3HeaderPresent =
        /<!--\s*kv3/i.test(
            text
        );


    const headerEndIndex =
        text.indexOf(
            '-->'
        );


    let searchStart =
        0;


    if (
        kv3HeaderPresent
        &&
        headerEndIndex >=
        0
    ) {

        searchStart =
            headerEndIndex +
            3;
    }


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
        kv3HeaderPresent,

        headerEndIndex,

        rootStart,

        rootEnd,

        inner:
            text.slice(
                rootStart +
                1,
                rootEnd
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
// TOP-LEVEL ENTRY PARSER
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
// VECTOR ENUM EXTRACTION
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
// LOW-LEVEL DELIMITER PARSER
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
// WHITESPACE / COMMENT / KEY
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


    return [
        ...output
    ];
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
// GENERIC
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
        '# Player Stat Modifier Source Universe Discovery V02'
    );

    lines.push('');

    lines.push(
        `Status: **${summary.status}**`
    );

    lines.push('');

    lines.push(
        '## Script132 V01 correction'
    );

    lines.push('');

    lines.push(
        'V01 is withdrawn. It selected a `{...}` version identifier inside the KV3 metadata header as the document root, which caused all resources to report zero top-level records.'
    );

    lines.push('');

    lines.push(
        'V02 explicitly skips the KV3 metadata header before locating the resource root.'
    );

    lines.push('');

    lines.push(
        '## Counts'
    );

    lines.push('');

    lines.push(
        `- Top-level records: ${summary.counts.topLevelRecords}`
    );

    lines.push(
        `- Modifier-bearing records: ${summary.counts.modifierBearingRecords}`
    );

    lines.push(
        `- Shop-item candidates: ${summary.counts.shopItemCandidates}`
    );

    lines.push(
        `- Hero-bound abilities: ${summary.counts.heroBoundAbilities}`
    );

    lines.push(
        `- Permanent world-buff candidates: ${summary.counts.permanentWorldBuffCandidates}`
    );

    lines.push(
        `- Temporary Powerup candidates: ${summary.counts.temporaryPowerupCandidates}`
    );

    lines.push(
        `- Objective-state candidates: ${summary.counts.objectiveStateCandidates}`
    );

    lines.push(
        `- Stat tokens: ${summary.counts.statTokens}`
    );

    lines.push(
        `- Ability-property keys: ${summary.counts.abilityPropertyKeys}`
    );

    lines.push('');

    lines.push(
        '## Guardrail'
    );

    lines.push('');

    lines.push(
        'This remains source-universe discovery. Activation conditions, stacking order, targets, duration and replay observability are not yet inferred.'
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