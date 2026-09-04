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
    'HERO_STAT_PROGRESSION_SCHEMA_DISCOVERY_V01';


// ============================================================
// PURPOSE
//
// Establish the foundational HERO STAT SCHEMA from the locally
// installed Deadlock build.
//
// We intentionally do this BEFORE:
//
//   - item-effect reconstruction
//   - Golden Statue / permanent buff reconstruction
//   - bridge Powerup reconstruction
//   - temporary ability/item buffs
//   - effective weapon calculations
//   - flying-soul opportunity modeling
//
// Questions:
//
// 1. What starting statistics exist?
//
// 2. Which starting statistics differ between heroes?
//
// 3. What standard level/boon upgrades exist?
//
// 4. Which heroes have special scaling relationships?
//
// 5. What purchase/category bonus structures exist?
//
// 6. Do Weapon / Vitality / Spirit investment bonus tables
//    appear universal or hero-specific?
//
// 7. What additional progression structures exist that must
//    eventually enter PlayerState(t)?
//
// This script is DISCOVERY.
//
// It does NOT:
//
//   - parse a replay
//   - calculate effective stats
//   - assume wiki values are canonical
//   - assume purchase bonuses are universal
//   - infer behavioral opportunities
//
// Source of mechanic constants:
//
//   LOCAL INSTALLED DEADLOCK BUILD
//
// Human-readable hero names:
//
//   Script129 V05
//
// heroId remains the durable identity key.
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


const HERO_DISPLAY_MAP_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_id_display_name_map_v05.json'
    );


const OUTPUT_JSON_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_stat_progression_schema_discovery_v01.json'
    );


const OUTPUT_MARKDOWN_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_stat_progression_schema_discovery_v01.md'
    );


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
// HERO RESOURCE
// ============================================================

const HERO_RESOURCE_PATH =
    'scripts/heroes.vdata_c';


// ============================================================
// HERO STRUCTURES OF INTEREST
// ============================================================

const STRUCTURES =
    {
        startingStats:
            'm_mapStartingStats',

        standardLevelUpUpgrades:
            'm_mapStandardLevelUpUpgrades',

        scalingStats:
            'm_mapScalingStats',

        purchaseBonuses:
            'm_mapPurchaseBonuses',

        levelInfo:
            'm_mapLevelInfo',

        boundAbilities:
            'm_mapBoundAbilities'
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


if (
    !existsSync(
        HERO_DISPLAY_MAP_PATH
    )
) {

    throw new Error(
        [
            'Missing Script129 V05 hero display-name map:',
            HERO_DISPLAY_MAP_PATH,
            '',
            'Run Script129 V05 first.'
        ].join(
            '\n'
        )
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
// HERO DISPLAY MAP
// ============================================================

const heroDisplayMap =
    JSON.parse(
        readFileSync(
            HERO_DISPLAY_MAP_PATH,
            'utf8'
        )
    );


if (
    heroDisplayMap?.status !==
    'DEADLOCK_HERO_ID_DISPLAY_NAME_MAP_READY'
) {

    throw new Error(
        `Hero display-name map not ready. Status=${heroDisplayMap?.status}`
    );
}


const displayNameByHeroId =
    heroDisplayMap.heroIdToDisplayName
    ??
    {};


const internalNameByHeroId =
    heroDisplayMap.heroIdToInternalName
    ??
    {};


const internalKeyByHeroId =
    heroDisplayMap.heroIdToInternalKey
    ??
    {};


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
    '========================================================'
);

console.log(
    'HERO STAT / PROGRESSION SCHEMA DISCOVERY V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    `Deadlock VPK:      ${pakPath}`
);

console.log(
    `Hero resource:     ${HERO_RESOURCE_PATH}`
);

console.log(
    'Replay parsing:    NONE'
);

console.log(
    'Wiki constants:    NONE'
);

console.log(
    'Effective stats:   NOT CALCULATED'
);

console.log('');


// ============================================================
// SOURCE2VIEWER VERSION
// ============================================================

const versionResult =
    spawnSync(
        SOURCE2VIEWER_PATH,
        [
            '--version'
        ],
        {
            encoding:
                'utf8',

            windowsHide:
                true
        }
    );


const source2ViewerVersion =
    [
        versionResult.stdout,
        versionResult.stderr
    ]
        .filter(
            Boolean
        )
        .join(
            '\n'
        )
        .trim()
        ||
        null;


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-hero-stat-schema-'
        )
    );


const desiredOutputPath =
    join(
        temporaryDirectory,
        'heroes.vdata'
    );


console.log(
    'Decompiling heroes.vdata...'
);


const extraction =
    spawnSync(
        SOURCE2VIEWER_PATH,
        [
            '--input',
            pakPath,

            '--vpk_filepath',
            HERO_RESOURCE_PATH,

            '--output',
            desiredOutputPath,

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
    extraction.status !==
    0
) {

    rmSync(
        temporaryDirectory,
        {
            recursive:
                true,

            force:
                true
        }
    );


    throw new Error(
        [
            'Source2Viewer hero extraction failed.',
            '',
            `Exit code: ${extraction.status}`,
            '',
            'STDOUT:',
            extraction.stdout
            ??
            '',
            '',
            'STDERR:',
            extraction.stderr
            ??
            ''
        ].join(
            '\n'
        )
    );
}


// ============================================================
// FIND OUTPUT
// ============================================================

let heroVdataPath =
    existsSync(
        desiredOutputPath
    )
        ? desiredOutputPath
        : findFileRecursive(
            temporaryDirectory,
            fileName =>
                fileName.toLowerCase() ===
                'heroes.vdata'
        );


if (
    !heroVdataPath
) {

    rmSync(
        temporaryDirectory,
        {
            recursive:
                true,

            force:
                true
        }
    );


    throw new Error(
        'heroes.vdata was not found after Source2Viewer extraction.'
    );
}


// ============================================================
// READ RESOURCE
// ============================================================

const heroBuffer =
    readFileSync(
        heroVdataPath
    );


const heroText =
    heroBuffer.toString(
        'utf8'
    );


const heroResourceSha256 =
    createHash(
        'sha256'
    )
        .update(
            heroBuffer
        )
        .digest(
            'hex'
        );


console.log(
    `Decompiled bytes:   ${heroBuffer.length}`
);

console.log(
    `Resource SHA256:    ${heroResourceSha256}`
);

console.log('');


// ============================================================
// HERO SEGMENTS
//
// Use m_HeroID as a durable record anchor.
//
// We intentionally avoid assuming top-level block names because
// internal resource naming may change independently of heroId.
// ============================================================

const heroIdMatches =
    [
        ...heroText.matchAll(
            /m_HeroID\s*=\s*(-?\d+)/g
        )
    ];


if (
    heroIdMatches.length ===
    0
) {

    rmSync(
        temporaryDirectory,
        {
            recursive:
                true,

            force:
                true
        }
    );


    throw new Error(
        'No m_HeroID records found in heroes.vdata.'
    );
}


const heroRecords =
    [];


for (
    let index =
        0;

    index <
        heroIdMatches.length;

    index++
) {

    const match =
        heroIdMatches[
            index
        ];


    const heroId =
        finite(
            match[1]
        );


    if (
        heroId ===
        null
        ||
        heroId <=
        0
    ) {

        continue;
    }


    const segmentStart =
        match.index;


    const segmentEnd =
        index +
        1 <
        heroIdMatches.length
            ? heroIdMatches[
                index +
                1
            ].index
            : heroText.length;


    const segment =
        heroText.slice(
            segmentStart,
            segmentEnd
        );


    const playerSelectable =
        captureBoolean(
            segment,
            'm_bPlayerSelectable'
        );


    const disabled =
        captureBoolean(
            segment,
            'm_bDisabled'
        );


    const inDevelopment =
        captureBoolean(
            segment,
            'm_bInDevelopment'
        );


    const startingStatsBlock =
        extractBalancedFieldBlock(
            segment,
            STRUCTURES.startingStats
        );


    const standardUpgradesBlock =
        extractBalancedFieldBlock(
            segment,
            STRUCTURES.standardLevelUpUpgrades
        );


    const scalingStatsBlock =
        extractBalancedFieldBlock(
            segment,
            STRUCTURES.scalingStats
        );


    const purchaseBonusesBlock =
        extractBalancedFieldBlock(
            segment,
            STRUCTURES.purchaseBonuses
        );


    const levelInfoBlock =
        extractBalancedFieldBlock(
            segment,
            STRUCTURES.levelInfo
        );


    const boundAbilitiesBlock =
        extractBalancedFieldBlock(
            segment,
            STRUCTURES.boundAbilities
        );


    const startingStats =
        startingStatsBlock
            ? parseFlatScalarMap(
                startingStatsBlock.inner
            )
            : {};


    const standardLevelUpUpgrades =
        standardUpgradesBlock
            ? parseFlatScalarMap(
                standardUpgradesBlock.inner
            )
            : {};


    const scalingStats =
        scalingStatsBlock
            ? parseScalingStats(
                scalingStatsBlock.inner
            )
            : [];


    const purchaseBonuses =
        purchaseBonusesBlock
            ? parsePurchaseBonuses(
                purchaseBonusesBlock.inner
            )
            : [];


    const levelInfo =
        levelInfoBlock
            ? parseLevelInfo(
                levelInfoBlock.inner
            )
            : {
                requiredGoldValues:
                    [],

                standardUpgradeFlags:
                    []
            };


    const boundAbilities =
        boundAbilitiesBlock
            ? parseFlatScalarMap(
                boundAbilitiesBlock.inner
            )
            : {};


    const displayName =
        displayNameByHeroId[
            String(
                heroId
            )
        ]
        ??
        internalNameByHeroId[
            String(
                heroId
            )
        ]
        ??
        `Hero ${heroId}`;


    heroRecords.push(
        {
            heroId,

            displayName,

            internalKey:
                internalKeyByHeroId[
                    String(
                        heroId
                    )
                ]
                ??
                null,

            internalName:
                internalNameByHeroId[
                    String(
                        heroId
                    )
                ]
                ??
                null,

            playerSelectable,

            disabled,

            inDevelopment,

            structuresPresent:
                {
                    startingStats:
                        Boolean(
                            startingStatsBlock
                        ),

                    standardLevelUpUpgrades:
                        Boolean(
                            standardUpgradesBlock
                        ),

                    scalingStats:
                        Boolean(
                            scalingStatsBlock
                        ),

                    purchaseBonuses:
                        Boolean(
                            purchaseBonusesBlock
                        ),

                    levelInfo:
                        Boolean(
                            levelInfoBlock
                        ),

                    boundAbilities:
                        Boolean(
                            boundAbilitiesBlock
                        )
                },

            startingStats,

            standardLevelUpUpgrades,

            scalingStats,

            purchaseBonuses,

            levelInfo,

            boundAbilities
        }
    );
}


// ============================================================
// SELECTABLE HERO COHORT
//
// null means the field could not be resolved.
// We preserve those separately rather than silently treating them
// as selectable.
// ============================================================

const selectableHeroes =
    heroRecords.filter(
        hero =>
            hero.playerSelectable ===
            true
    );


const unresolvedSelectableState =
    heroRecords.filter(
        hero =>
            hero.playerSelectable ===
            null
    );


// ============================================================
// STARTING STAT SCHEMA
// ============================================================

const startingStatSchema =
    buildScalarSchema(
        selectableHeroes,
        hero =>
            hero.startingStats
    );


// ============================================================
// STANDARD LEVEL / BOON SCHEMA
// ============================================================

const standardUpgradeSchema =
    buildScalarSchema(
        selectableHeroes,
        hero =>
            hero.standardLevelUpUpgrades
    );


// ============================================================
// SPECIAL SCALING SCHEMA
// ============================================================

const scalingRelationships =
    [];


for (
    const hero
    of selectableHeroes
) {

    for (
        const relation
        of hero.scalingStats
    ) {

        scalingRelationships.push(
            {
                heroId:
                    hero.heroId,

                displayName:
                    hero.displayName,

                internalKey:
                    hero.internalKey,

                recordKey:
                    relation.recordKey,

                scalingStat:
                    relation.scalingStat,

                scale:
                    relation.scale,

                raw:
                    relation.raw
            }
        );
    }
}


const scalingStatSummary =
    summarizeScalingRelationships(
        scalingRelationships
    );


// ============================================================
// PURCHASE BONUS / CATEGORY INVESTMENT SCHEMA
// ============================================================

const purchaseBonusRows =
    [];


for (
    const hero
    of selectableHeroes
) {

    for (
        const bonus
        of hero.purchaseBonuses
    ) {

        purchaseBonusRows.push(
            {
                heroId:
                    hero.heroId,

                displayName:
                    hero.displayName,

                internalKey:
                    hero.internalKey,

                ...bonus
            }
        );
    }
}


const purchaseBonusCategories =
    summarizePurchaseBonusCategories(
        selectableHeroes
    );


// ============================================================
// PURCHASE TABLE CONSISTENCY
//
// If every selectable hero has the same table for a category,
// that strongly supports treating the category table as a global
// progression rule.
//
// We still do not call it canonical until inspection.
// ============================================================

const purchaseBonusConsistency =
    buildPurchaseBonusConsistency(
        selectableHeroes
    );


// ============================================================
// LEVEL INFO SUMMARY
// ============================================================

const levelInfoSummary =
    {
        heroesWithLevelInfo:
            selectableHeroes.filter(
                hero =>
                    hero.structuresPresent.levelInfo
            ).length,

        uniqueRequiredGoldSequences:
            countUniqueArrays(
                selectableHeroes.map(
                    hero =>
                        hero.levelInfo.requiredGoldValues
                )
            ),

        requiredGoldSequenceExamples:
            uniqueArrayExamples(
                selectableHeroes.map(
                    hero => ({
                        heroId:
                            hero.heroId,

                        displayName:
                            hero.displayName,

                        values:
                            hero.levelInfo.requiredGoldValues
                    })
                ),
                10
            )
    };


// ============================================================
// STRUCTURE COVERAGE
// ============================================================

const structureCoverage =
    {};


for (
    const key
    of Object.keys(
        STRUCTURES
    )
) {

    structureCoverage[
        key
    ] =
        {
            present:
                selectableHeroes.filter(
                    hero =>
                        hero.structuresPresent[
                            key
                        ] ===
                        true
                ).length,

            total:
                selectableHeroes.length
        };
}


// ============================================================
// OBSERVED PROJECT HERO COVERAGE
// ============================================================

const observedHeroIds =
    Array.isArray(
        heroDisplayMap.observedCrosswalk
    )
        ? heroDisplayMap.observedCrosswalk
            .map(
                row =>
                    finite(
                        row.heroId
                    )
            )
            .filter(
                Number.isFinite
            )
        : [];


const localHeroIdSet =
    new Set(
        heroRecords.map(
            hero =>
                hero.heroId
        )
    );


const observedResolved =
    observedHeroIds.filter(
        heroId =>
            localHeroIdSet.has(
                heroId
            )
    );


// ============================================================
// HIGH-LEVEL INTERPRETATION
// ============================================================

const interpretation =
    {
        startingStats:
            'Raw hero intrinsic starting-stat parameters from local heroes.vdata.',

        standardLevelUpUpgrades:
            'Raw standard level/boon progression parameters. Their exact semantic application order remains to be validated before effective-stat calculation.',

        scalingStats:
            'Hero-specific cross-stat scaling relationships. These are especially important because changing one state variable such as Spirit may alter another hero statistic.',

        purchaseBonuses:
            'Category-investment progression structures associated with item-slot categories. These are progression effects separate from the individual properties of the purchased item.',

        levelInfo:
            'Hero progression/required-gold substrate. No assumption is made here that replay boon state has already been reconstructed.',

        keyGuardrail:
            'Resource-defined base and progression values are not the same as effective runtime PlayerState(t). Items, permanent buffs, temporary buffs, ability state, debuffs, and other modifiers remain separate layers.'
    };


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
    {
        heroRecordsParsed:
            check(
                heroRecords.length,
                '>0',
                heroRecords.length >
                0
            ),


        heroIdentityCoverage:
            check(
                observedResolved.length,
                observedHeroIds.length,
                observedHeroIds.length >
                0
                &&
                observedResolved.length ===
                observedHeroIds.length
            ),


        selectableHeroesFound:
            check(
                selectableHeroes.length,
                '>0',
                selectableHeroes.length >
                0
            ),


        startingStatsAvailable:
            check(
                Object.keys(
                    startingStatSchema
                ).length,
                '>0',
                Object.keys(
                    startingStatSchema
                ).length >
                0
            ),


        standardUpgradeSchemaAvailable:
            check(
                Object.keys(
                    standardUpgradeSchema
                ).length,
                '>0',
                Object.keys(
                    standardUpgradeSchema
                ).length >
                0
            ),


        purchaseBonusDataAvailable:
            check(
                purchaseBonusRows.length,
                '>0',
                purchaseBonusRows.length >
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
        ? 'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION'
        : 'HERO_STAT_SCHEMA_DISCOVERY_REQUIRES_DIAGNOSIS';


const nextStage =
    validationPass
        ? 'INSPECT_SCHEMA_THEN_DISCOVER_ITEM_PERMANENT_BUFF_POWERUP_AND_OTHER_STAT_MODIFIER_SOURCES'
        : 'DIAGNOSE_MISSING_HERO_STAT_STRUCTURES';


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

        source:
            {
                method:
                    'LOCAL_INSTALLED_DEADLOCK_HERO_VDATA',

                pakPath,

                pakBytes:
                    statSync(
                        pakPath
                    ).size,

                heroResource:
                    HERO_RESOURCE_PATH,

                heroResourceBytes:
                    heroBuffer.length,

                heroResourceSha256,

                source2ViewerPath:
                    SOURCE2VIEWER_PATH,

                source2ViewerVersion,

                temporaryResourceDeleted:
                    true
            },

        counts:
            {
                heroIdRecords:
                    heroRecords.length,

                selectableHeroes:
                    selectableHeroes.length,

                unresolvedSelectableState:
                    unresolvedSelectableState.length,

                observedProjectHeroIds:
                    observedHeroIds.length,

                observedProjectHeroIdsResolved:
                    observedResolved.length,

                startingStatKeys:
                    Object.keys(
                        startingStatSchema
                    ).length,

                standardLevelUpUpgradeKeys:
                    Object.keys(
                        standardUpgradeSchema
                    ).length,

                specialScalingRelationships:
                    scalingRelationships.length,

                purchaseBonusRows:
                    purchaseBonusRows.length,

                purchaseBonusCategories:
                    Object.keys(
                        purchaseBonusCategories
                    ).length
            },

        structureCoverage,

        startingStatSchema,

        standardUpgradeSchema,

        scalingStatSummary,

        scalingRelationships,

        purchaseBonusCategories,

        purchaseBonusConsistency,

        purchaseBonusRows,

        levelInfoSummary,

        heroes:
            selectableHeroes,

        unresolvedSelectableState,

        interpretation,

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
    'HERO RESOURCE COVERAGE'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    `Hero ID records:              ${heroRecords.length}`
);

console.log(
    `Player-selectable heroes:     ${selectableHeroes.length}`
);

console.log(
    `Selectable state unresolved:  ${unresolvedSelectableState.length}`
);

console.log(
    `Observed project IDs resolved:${observedResolved.length}/${observedHeroIds.length}`
);

console.log('');


// ============================================================
// STARTING STATS
// ============================================================

console.log(
    'STARTING STAT SCHEMA'
);

console.log(
    '--------------------'
);


for (
    const [
        key,
        row
    ]
    of Object.entries(
        startingStatSchema
    )
) {

    console.log(
        `${key.padEnd(42)} ` +
        `heroes=${String(row.heroCount).padStart(3)}/${selectableHeroes.length} ` +
        `unique=${String(row.uniqueValueCount).padStart(3)} ` +
        `min=${formatNumber(row.numericMin).padEnd(10)} ` +
        `max=${formatNumber(row.numericMax).padEnd(10)}`
    );
}


console.log('');


// ============================================================
// STANDARD UPGRADES
// ============================================================

console.log(
    'STANDARD LEVEL / BOON UPGRADE SCHEMA'
);

console.log(
    '------------------------------------'
);


for (
    const [
        key,
        row
    ]
    of Object.entries(
        standardUpgradeSchema
    )
) {

    console.log(
        `${key.padEnd(42)} ` +
        `heroes=${String(row.heroCount).padStart(3)}/${selectableHeroes.length} ` +
        `unique=${String(row.uniqueValueCount).padStart(3)} ` +
        `min=${formatNumber(row.numericMin).padEnd(10)} ` +
        `max=${formatNumber(row.numericMax).padEnd(10)}`
    );
}


console.log('');


// ============================================================
// SPECIAL SCALING
// ============================================================

console.log(
    'SPECIAL HERO SCALING RELATIONSHIPS'
);

console.log(
    '----------------------------------'
);


if (
    scalingRelationships.length ===
    0
) {

    console.log(
        'NONE PARSED'
    );

} else {

    for (
        const row
        of scalingRelationships
    ) {

        console.log(
            `${`${row.displayName} (${row.heroId})`.padEnd(28)} ` +
            `record=${String(row.recordKey ?? 'UNKNOWN').padEnd(28)} ` +
            `scalingStat=${String(row.scalingStat ?? 'UNKNOWN').padEnd(40)} ` +
            `scale=${formatNumber(row.scale)}`
        );
    }
}


console.log('');


// ============================================================
// PURCHASE BONUS CATEGORIES
// ============================================================

console.log(
    'CATEGORY INVESTMENT / PURCHASE BONUS SCHEMA'
);

console.log(
    '-------------------------------------------'
);


for (
    const [
        category,
        row
    ]
    of Object.entries(
        purchaseBonusCategories
    )
) {

    console.log(
        `${category.padEnd(18)} ` +
        `heroes=${String(row.heroCount).padStart(3)}/${selectableHeroes.length} ` +
        `rows=${String(row.rowCount).padStart(4)} ` +
        `tiers=${row.tiers.join(',')}`
    );
}


console.log('');

console.log(
    'PURCHASE BONUS TABLE CONSISTENCY'
);

console.log(
    '--------------------------------'
);


for (
    const [
        category,
        row
    ]
    of Object.entries(
        purchaseBonusConsistency
    )
) {

    console.log(
        `${category.padEnd(18)} ` +
        `heroes=${String(row.heroCount).padStart(3)} ` +
        `uniqueTables=${String(row.uniqueTableCount).padStart(3)} ` +
        `universal=${row.universalAcrossObservedHeroes}`
    );
}


console.log('');


// ============================================================
// HERO EXCEPTION SUMMARY
// ============================================================

console.log(
    'HEROES WITH SPECIAL SCALING'
);

console.log(
    '---------------------------'
);


const heroesWithScaling =
    selectableHeroes
        .filter(
            hero =>
                hero.scalingStats.length >
                0
        );


if (
    heroesWithScaling.length ===
    0
) {

    console.log(
        'NONE'
    );

} else {

    for (
        const hero
        of heroesWithScaling
    ) {

        console.log(
            `${hero.displayName} (${hero.heroId}) ` +
            `relationships=${hero.scalingStats.length}`
        );
    }
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
        `${name.padEnd(40)} ${row.pass} ` +
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
// PARSING: BALANCED FIELD BLOCK
// ============================================================

function extractBalancedFieldBlock(
    text,
    fieldName
) {

    const escapedField =
        escapeRegex(
            fieldName
        );


    const regex =
        new RegExp(
            `${escapedField}\\s*=\\s*\\{`,
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


    const openBraceIndex =
        text.indexOf(
            '{',
            match.index
        );


    if (
        openBraceIndex <
        0
    ) {

        return null;
    }


    const closeBraceIndex =
        findMatchingDelimiter(
            text,
            openBraceIndex,
            '{',
            '}'
        );


    if (
        closeBraceIndex ===
        null
    ) {

        return null;
    }


    return {
        start:
            openBraceIndex,

        end:
            closeBraceIndex,

        raw:
            text.slice(
                openBraceIndex,
                closeBraceIndex +
                1
            ),

        inner:
            text.slice(
                openBraceIndex +
                1,
                closeBraceIndex
            )
    };
}


// ============================================================
// GENERIC TOP-LEVEL MAP PARSER
// ============================================================

function parseTopLevelEntries(
    text
) {

    const entries =
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


        const keyResult =
            readKey(
                text,
                index
            );


        if (
            !keyResult
        ) {

            index++;
            continue;
        }


        index =
            keyResult.end;


        index =
            skipWhitespaceAndComments(
                text,
                index
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


        const startValue =
            index;


        const first =
            text[
                index
            ];


        if (
            first ===
            '{'
        ) {

            const end =
                findMatchingDelimiter(
                    text,
                    index,
                    '{',
                    '}'
                );


            if (
                end ===
                null
            ) {

                break;
            }


            entries.push(
                {
                    key:
                        keyResult.key,

                    type:
                        'object',

                    rawValue:
                        text.slice(
                            index,
                            end +
                            1
                        ),

                    inner:
                        text.slice(
                            index +
                            1,
                            end
                        )
                }
            );


            index =
                end +
                1;

            continue;
        }


        if (
            first ===
            '['
        ) {

            const end =
                findMatchingDelimiter(
                    text,
                    index,
                    '[',
                    ']'
                );


            if (
                end ===
                null
            ) {

                break;
            }


            entries.push(
                {
                    key:
                        keyResult.key,

                    type:
                        'array',

                    rawValue:
                        text.slice(
                            index,
                            end +
                            1
                        ),

                    inner:
                        text.slice(
                            index +
                            1,
                            end
                        )
                }
            );


            index =
                end +
                1;

            continue;
        }


        const scalarResult =
            readScalarUntilLineEnd(
                text,
                startValue
            );


        entries.push(
            {
                key:
                    keyResult.key,

                type:
                    'scalar',

                rawValue:
                    scalarResult.value,

                inner:
                    null
            }
        );


        index =
            scalarResult.end;
    }


    return entries;
}


// ============================================================
// FLAT SCALAR MAP
// ============================================================

function parseFlatScalarMap(
    block
) {

    const result =
        {};


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
            'scalar'
        ) {

            continue;
        }


        result[
            entry.key
        ] =
            parseScalar(
                entry.rawValue
            );
    }


    return result;
}


// ============================================================
// SPECIAL SCALING
// ============================================================

function parseScalingStats(
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


        const child =
            parseFlatScalarMap(
                entry.inner
            );


        const scalingStat =
            child.eScalingStat
            ??
            child.m_eScalingStat
            ??
            null;


        const scale =
            finite(
                child.flScale
                ??
                child.m_flScale
            );


        rows.push(
            {
                recordKey:
                    entry.key,

                scalingStat,

                scale,

                raw:
                    child
            }
        );
    }


    return rows;
}


// ============================================================
// PURCHASE BONUSES
// ============================================================

function parsePurchaseBonuses(
    block
) {

    const rows =
        [];


    const categoryEntries =
        parseTopLevelEntries(
            block
        );


    for (
        const categoryEntry
        of categoryEntries
    ) {

        if (
            categoryEntry.type !==
            'array'
            &&
            categoryEntry.type !==
            'object'
        ) {

            continue;
        }


        const normalizedCategory =
            normalizePurchaseCategory(
                categoryEntry.key
            );


        const objectBodies =
            extractObjectBodies(
                categoryEntry.inner
            );


        // Some resource forms may contain one object directly
        // rather than an array of anonymous objects.
        if (
            objectBodies.length ===
            0
            &&
            categoryEntry.type ===
            'object'
        ) {

            objectBodies.push(
                categoryEntry.inner
            );
        }


        for (
            const objectBody
            of objectBodies
        ) {

            const child =
                parseFlatScalarMap(
                    objectBody
                );


            const valueType =
                child.m_ValueType
                ??
                child.ValueType
                ??
                null;


            const tier =
                finite(
                    child.m_nTier
                    ??
                    child.nTier
                );


            const value =
                child.m_strValue
                ??
                child.strValue
                ??
                null;


            // Only retain structures that look like an actual
            // purchase-bonus record.
            if (
                valueType ===
                null
                &&
                tier ===
                null
                &&
                value ===
                null
            ) {

                continue;
            }


            rows.push(
                {
                    rawCategory:
                        categoryEntry.key,

                    category:
                        normalizedCategory,

                    valueType,

                    tier,

                    value,

                    raw:
                        child
                }
            );
        }
    }


    return rows;
}


// ============================================================
// LEVEL INFO
// ============================================================

function parseLevelInfo(
    block
) {

    const requiredGoldValues =
        [];


    const standardUpgradeFlags =
        [];


    const goldRegex =
        /m_unRequiredGold\s*=\s*([^\r\n]+)/g;


    for (
        const match
        of block.matchAll(
            goldRegex
        )
    ) {

        const value =
            finite(
                parseScalar(
                    match[1]
                )
            );


        if (
            value !==
            null
        ) {

            requiredGoldValues.push(
                value
            );
        }
    }


    const flagRegex =
        /m_bUseStandardUpgrade\s*=\s*([^\r\n]+)/g;


    for (
        const match
        of block.matchAll(
            flagRegex
        )
    ) {

        standardUpgradeFlags.push(
            parseScalar(
                match[1]
            )
        );
    }


    return {
        requiredGoldValues,

        standardUpgradeFlags
    };
}


// ============================================================
// OBJECT EXTRACTION FROM ARRAY / NESTED TEXT
// ============================================================

function extractObjectBodies(
    text
) {

    const bodies =
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


        bodies.push(
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


    return bodies;
}


// ============================================================
// SCHEMA AGGREGATION
// ============================================================

function buildScalarSchema(
    heroes,
    selector
) {

    const map =
        new Map();


    for (
        const hero
        of heroes
    ) {

        const values =
            selector(
                hero
            )
            ??
            {};


        for (
            const [
                key,
                value
            ]
            of Object.entries(
                values
            )
        ) {

            if (
                !map.has(
                    key
                )
            ) {

                map.set(
                    key,
                    {
                        heroes:
                            [],

                        values:
                            []
                    }
                );
            }


            const row =
                map.get(
                    key
                );


            row.heroes.push(
                {
                    heroId:
                        hero.heroId,

                    displayName:
                        hero.displayName,

                    value
                }
            );


            row.values.push(
                value
            );
        }
    }


    const output =
        {};


    for (
        const [
            key,
            row
        ]
        of [
            ...map.entries()
        ]
            .sort(
                (
                    a,
                    b
                ) =>
                    a[0].localeCompare(
                        b[0]
                    )
            )
    ) {

        const numericValues =
            row.values
                .map(
                    finite
                )
                .filter(
                    Number.isFinite
                );


        const uniqueValues =
            [
                ...new Set(
                    row.values.map(
                        stableValueString
                    )
                )
            ];


        output[
            key
        ] =
            {
                heroCount:
                    row.heroes.length,

                uniqueValueCount:
                    uniqueValues.length,

                variesAcrossHeroes:
                    uniqueValues.length >
                    1,

                numericMin:
                    numericValues.length >
                    0
                        ? Math.min(
                            ...numericValues
                        )
                        : null,

                numericMax:
                    numericValues.length >
                    0
                        ? Math.max(
                            ...numericValues
                        )
                        : null,

                examples:
                    row.heroes.slice(
                        0,
                        12
                    )
            };
    }


    return output;
}


// ============================================================
// SCALING SUMMARY
// ============================================================

function summarizeScalingRelationships(
    rows
) {

    const byStat =
        new Map();


    for (
        const row
        of rows
    ) {

        const key =
            String(
                row.scalingStat
                ??
                'UNRESOLVED'
            );


        if (
            !byStat.has(
                key
            )
        ) {

            byStat.set(
                key,
                []
            );
        }


        byStat.get(
            key
        ).push(
            row
        );
    }


    return Object.fromEntries(
        [
            ...byStat.entries()
        ]
            .sort(
                (
                    a,
                    b
                ) =>
                    b[1].length -
                    a[1].length
                    ||
                    a[0].localeCompare(
                        b[0]
                    )
            )
            .map(
                ([
                    key,
                    value
                ]) => [
                    key,
                    {
                        relationshipCount:
                            value.length,

                        heroCount:
                            new Set(
                                value.map(
                                    row =>
                                        row.heroId
                                )
                            ).size,

                        heroes:
                            value.map(
                                row => ({
                                    heroId:
                                        row.heroId,

                                    displayName:
                                        row.displayName,

                                    scale:
                                        row.scale,

                                    recordKey:
                                        row.recordKey
                                })
                            )
                    }
                ]
            )
    );
}


// ============================================================
// PURCHASE BONUS SUMMARY
// ============================================================

function summarizePurchaseBonusCategories(
    heroes
) {

    const map =
        new Map();


    for (
        const hero
        of heroes
    ) {

        for (
            const row
            of hero.purchaseBonuses
        ) {

            const category =
                row.category
                ??
                'UNRESOLVED';


            if (
                !map.has(
                    category
                )
            ) {

                map.set(
                    category,
                    {
                        heroIds:
                            new Set(),

                        rows:
                            [],

                        tiers:
                            new Set(),

                        rawCategories:
                            new Set(),

                        valueTypes:
                            new Set()
                    }
                );
            }


            const target =
                map.get(
                    category
                );


            target.heroIds.add(
                hero.heroId
            );


            target.rows.push(
                row
            );


            if (
                Number.isFinite(
                    row.tier
                )
            ) {

                target.tiers.add(
                    row.tier
                );
            }


            if (
                row.rawCategory
            ) {

                target.rawCategories.add(
                    row.rawCategory
                );
            }


            if (
                row.valueType
            ) {

                target.valueTypes.add(
                    row.valueType
                );
            }
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
                    a[0].localeCompare(
                        b[0]
                    )
            )
            .map(
                ([
                    category,
                    row
                ]) => [
                    category,
                    {
                        heroCount:
                            row.heroIds.size,

                        rowCount:
                            row.rows.length,

                        tiers:
                            [
                                ...row.tiers
                            ].sort(
                                (
                                    a,
                                    b
                                ) =>
                                    a -
                                    b
                            ),

                        rawCategories:
                            [
                                ...row.rawCategories
                            ].sort(),

                        valueTypes:
                            [
                                ...row.valueTypes
                            ].sort()
                    }
                ]
            )
    );
}


// ============================================================
// PURCHASE BONUS CONSISTENCY
// ============================================================

function buildPurchaseBonusConsistency(
    heroes
) {

    const categories =
        new Set();


    for (
        const hero
        of heroes
    ) {

        for (
            const row
            of hero.purchaseBonuses
        ) {

            categories.add(
                row.category
            );
        }
    }


    const output =
        {};


    for (
        const category
        of categories
    ) {

        const signatures =
            new Map();


        let heroCount =
            0;


        for (
            const hero
            of heroes
        ) {

            const rows =
                hero.purchaseBonuses
                    .filter(
                        row =>
                            row.category ===
                            category
                    )
                    .map(
                        row => ({
                            tier:
                                row.tier,

                            valueType:
                                row.valueType,

                            value:
                                row.value
                        })
                    )
                    .sort(
                        (
                            a,
                            b
                        ) =>
                            (
                                a.tier
                                ??
                                999
                            )
                            -
                            (
                                b.tier
                                ??
                                999
                            )
                            ||
                            String(
                                a.valueType
                            ).localeCompare(
                                String(
                                    b.valueType
                                )
                            )
                    );


            if (
                rows.length ===
                0
            ) {

                continue;
            }


            heroCount++;


            const signature =
                JSON.stringify(
                    rows
                );


            if (
                !signatures.has(
                    signature
                )
            ) {

                signatures.set(
                    signature,
                    []
                );
            }


            signatures.get(
                signature
            ).push(
                {
                    heroId:
                        hero.heroId,

                    displayName:
                        hero.displayName
                }
            );
        }


        output[
            category
        ] =
            {
                heroCount,

                uniqueTableCount:
                    signatures.size,

                universalAcrossObservedHeroes:
                    heroCount >
                    0
                    &&
                    signatures.size ===
                    1,

                tables:
                    [
                        ...signatures.entries()
                    ]
                        .map(
                            ([
                                signature,
                                signatureHeroes
                            ]) => ({
                                heroes:
                                    signatureHeroes,

                                rows:
                                    JSON.parse(
                                        signature
                                    )
                            })
                        )
            };
    }


    return output;
}


// ============================================================
// PURCHASE CATEGORY NORMALIZATION
//
// Preserve raw resource category separately.
// This is a readability layer only.
// ============================================================

function normalizePurchaseCategory(
    raw
) {

    const lower =
        String(
            raw
            ??
            ''
        ).toLowerCase();


    if (
        lower.includes(
            'weapon'
        )
    ) {

        return 'WEAPON';
    }


    if (
        lower.includes(
            'armor'
        )
        ||
        lower.includes(
            'vital'
        )
    ) {

        return 'VITALITY';
    }


    if (
        lower.includes(
            'tech'
        )
        ||
        lower.includes(
            'spirit'
        )
    ) {

        return 'SPIRIT';
    }


    return String(
        raw
        ??
        'UNRESOLVED'
    );
}


// ============================================================
// LOW-LEVEL PARSER
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
    startIndex
) {

    let inQuote =
        false;


    let escaped =
        false;


    for (
        let index =
            startIndex;

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


function skipWhitespaceAndComments(
    text,
    startIndex
) {

    let index =
        startIndex;


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
    startIndex
) {

    if (
        startIndex >=
        text.length
    ) {

        return null;
    }


    if (
        text[
            startIndex
        ] ===
        '"'
    ) {

        let index =
            startIndex +
            1;


        let escaped =
            false;


        let value =
            '';


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
                startIndex
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
            startIndex +
            match[
                1
            ].length
    };
}


function readScalarUntilLineEnd(
    text,
    startIndex
) {

    let index =
        startIndex;


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
                    startIndex,
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
        value ===
        'null'
    ) {

        return null;
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


    // Preserve typed KV3/resource literals and enums as strings.
    return value;
}


// ============================================================
// FIELD HELPERS
// ============================================================

function captureBoolean(
    text,
    fieldName
) {

    const escaped =
        escapeRegex(
            fieldName
        );


    const match =
        text.match(
            new RegExp(
                `${escaped}\\s*=\\s*(true|false|0|1)`,
                'i'
            )
        );


    if (
        !match
    ) {

        return null;
    }


    const value =
        match[
            1
        ].toLowerCase();


    return value ===
        'true'
        ||
        value ===
        '1';
}


// ============================================================
// ARRAY SUMMARY HELPERS
// ============================================================

function countUniqueArrays(
    arrays
) {

    return new Set(
        arrays.map(
            value =>
                JSON.stringify(
                    value
                )
        )
    ).size;
}


function uniqueArrayExamples(
    rows,
    limit
) {

    const seen =
        new Set();


    const output =
        [];


    for (
        const row
        of rows
    ) {

        const signature =
            JSON.stringify(
                row.values
            );


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


        output.push(
            row
        );


        if (
            output.length >=
            limit
        ) {

            break;
        }
    }


    return output;
}


// ============================================================
// GENERIC HELPERS
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


function stableValueString(
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


function formatNumber(
    value
) {

    return Number.isFinite(
        value
    )
        ? Number(
            value.toFixed(
                6
            )
        ).toString()
        : 'n/a';
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

            const result =
                findFileRecursive(
                    path,
                    predicate
                );


            if (
                result
            ) {

                return result;
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
        '# Hero Stat / Progression Schema Discovery V01'
    );

    lines.push('');

    lines.push(
        `Status: **${summary.status}**`
    );

    lines.push('');

    lines.push(
        '## Scope'
    );

    lines.push('');

    lines.push(
        'This checkpoint establishes intrinsic hero and progression stat structures from the locally installed Deadlock build. It does not calculate effective runtime stats.'
    );

    lines.push('');

    lines.push(
        `- Hero records: ${summary.counts.heroIdRecords}`
    );

    lines.push(
        `- Player-selectable heroes: ${summary.counts.selectableHeroes}`
    );

    lines.push(
        `- Starting-stat keys: ${summary.counts.startingStatKeys}`
    );

    lines.push(
        `- Standard level/boon upgrade keys: ${summary.counts.standardLevelUpUpgradeKeys}`
    );

    lines.push(
        `- Special scaling relationships: ${summary.counts.specialScalingRelationships}`
    );

    lines.push(
        `- Purchase bonus rows: ${summary.counts.purchaseBonusRows}`
    );

    lines.push('');

    lines.push(
        '## Starting-stat schema'
    );

    lines.push('');


    for (
        const [
            key,
            row
        ]
        of Object.entries(
            summary.startingStatSchema
        )
    ) {

        lines.push(
            `- **${key}** — heroes=${row.heroCount}, unique=${row.uniqueValueCount}, varies=${row.variesAcrossHeroes}`
        );
    }


    lines.push('');

    lines.push(
        '## Standard level / boon schema'
    );

    lines.push('');


    for (
        const [
            key,
            row
        ]
        of Object.entries(
            summary.standardUpgradeSchema
        )
    ) {

        lines.push(
            `- **${key}** — heroes=${row.heroCount}, unique=${row.uniqueValueCount}, varies=${row.variesAcrossHeroes}`
        );
    }


    lines.push('');

    lines.push(
        '## Special scaling relationships'
    );

    lines.push('');


    for (
        const row
        of summary.scalingRelationships
    ) {

        lines.push(
            `- **${row.displayName} (${row.heroId})** — ${row.scalingStat ?? 'UNRESOLVED'} scale=${row.scale ?? 'UNRESOLVED'}`
        );
    }


    lines.push('');

    lines.push(
        '## Category investment consistency'
    );

    lines.push('');


    for (
        const [
            category,
            row
        ]
        of Object.entries(
            summary.purchaseBonusConsistency
        )
    ) {

        lines.push(
            `- **${category}** — heroes=${row.heroCount}, unique tables=${row.uniqueTableCount}, universal in parsed cohort=${row.universalAcrossObservedHeroes}`
        );
    }


    lines.push('');

    lines.push(
        '## Guardrail'
    );

    lines.push('');

    lines.push(
        'These values describe hero/resource progression substrate. Effective PlayerState(t) still requires items, permanent buffs, temporary Powerups, ability/passive state, external buffs/debuffs, and any other modifier sources.'
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