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
    'HERO_STAT_PROGRESSION_SCHEMA_DISCOVERY_V02';


// ============================================================
// PURPOSE
//
// Script131 V01 successfully established:
//
//   - starting-stat schema
//   - standard level / boon upgrades
//   - special hero cross-stat scaling
//   - m_mapPurchaseBonuses
//
// But V01 labeled m_mapPurchaseBonuses as the category
// investment / soul-spend breakpoint table.
//
// That interpretation is withdrawn.
//
// heroes.vdata contains TWO distinct structures:
//
//   m_mapPurchaseBonuses
//
//     entries use:
//       m_ValueType
//       m_nTier
//       m_strValue
//
//   m_MapModCostBonuses
//
//     entries use:
//       nGoldThreshold
//       flBonus
//       flPercentOnGraph
//
// The latter is structurally the much stronger candidate for
// the Weapon / Vitality / Spirit investment breakpoint system
// described by the user.
//
// V02:
//
//   1. preserves Script131 V01;
//
//   2. extracts m_MapModCostBonuses from every selectable hero;
//
//   3. determines whether those tables are universal or
//      hero-specific;
//
//   4. prints exact gold thresholds and bonuses;
//
//   5. keeps m_mapPurchaseBonuses explicitly separate;
//
//   6. does NOT yet assign gameplay semantics beyond what the
//      field structure itself supports.
//
// No replay parsing.
// No effective PlayerState(t) calculation.
// No wiki constants.
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


const SCRIPT131_V01_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_stat_progression_schema_discovery_v01.json'
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
        'hero_stat_progression_schema_discovery_v02.json'
    );


const OUTPUT_MARKDOWN_PATH =
    resolve(
        'output',
        'cross_replay',
        'hero_stat_progression_schema_discovery_v02.md'
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
// RESOURCE
// ============================================================

const HERO_RESOURCE_PATH =
    'scripts/heroes.vdata_c';


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
        SCRIPT131_V01_PATH
    )
) {

    throw new Error(
        [
            'Missing Script131 V01 output:',
            SCRIPT131_V01_PATH
        ].join(
            '\n'
        )
    );
}


if (
    !existsSync(
        HERO_DISPLAY_MAP_PATH
    )
) {

    throw new Error(
        [
            'Missing Script129 V05 hero map:',
            HERO_DISPLAY_MAP_PATH
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
// LOAD PRIOR OUTPUTS
// ============================================================

const v01 =
    JSON.parse(
        readFileSync(
            SCRIPT131_V01_PATH,
            'utf8'
        )
    );


if (
    v01?.status !==
    'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION'
) {

    throw new Error(
        `Script131 V01 not ready. Status=${v01?.status}`
    );
}


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
        `Hero display map not ready. Status=${heroDisplayMap?.status}`
    );
}


const displayNameByHeroId =
    heroDisplayMap.heroIdToDisplayName
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
    'HERO STAT / PROGRESSION SCHEMA DISCOVERY V0.2'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'V01 intrinsic schema:      PRESERVED'
);

console.log(
    'm_mapPurchaseBonuses:      DISTINCT 5-TIER STRUCTURE'
);

console.log(
    'm_MapModCostBonuses:       GOLD-THRESHOLD STRUCTURE'
);

console.log(
    'Replay parsing:            NONE'
);

console.log(
    'Effective stat inference:  NONE'
);

console.log('');


// ============================================================
// TEMP RESOURCE EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-hero-cost-bonus-v02-'
        )
    );


const desiredOutputPath =
    join(
        temporaryDirectory,
        'heroes.vdata'
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
            'Source2Viewer extraction failed.',
            '',
            `Exit code: ${extraction.status}`,
            '',
            extraction.stdout
            ??
            '',
            '',
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
        'heroes.vdata not found after extraction.'
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


// ============================================================
// HERO SEGMENTS
// ============================================================

const heroIdMatches =
    [
        ...heroText.matchAll(
            /m_HeroID\s*=\s*(-?\d+)/g
        )
    ];


const heroes =
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


    const start =
        match.index;


    const end =
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
            start,
            end
        );


    const playerSelectable =
        captureBoolean(
            segment,
            'm_bPlayerSelectable'
        );


    const block =
        extractBalancedFieldBlock(
            segment,
            'm_MapModCostBonuses'
        );


    const rows =
        block
            ? parseMapModCostBonuses(
                block.inner
            )
            : [];


    heroes.push(
        {
            heroId,

            displayName:
                displayNameByHeroId[
                    String(
                        heroId
                    )
                ]
                ??
                `Hero ${heroId}`,

            internalKey:
                internalKeyByHeroId[
                    String(
                        heroId
                    )
                ]
                ??
                null,

            playerSelectable,

            mapModCostBonuses:
                rows
        }
    );
}


// ============================================================
// SELECTABLE HEROES
// ============================================================

const selectableHeroes =
    heroes.filter(
        hero =>
            hero.playerSelectable ===
            true
    );


// ============================================================
// FLATTEN ROWS
// ============================================================

const allRows =
    [];


for (
    const hero
    of selectableHeroes
) {

    for (
        const row
        of hero.mapModCostBonuses
    ) {

        allRows.push(
            {
                heroId:
                    hero.heroId,

                displayName:
                    hero.displayName,

                internalKey:
                    hero.internalKey,

                ...row
            }
        );
    }
}


// ============================================================
// CATEGORY SUMMARY
// ============================================================

const categories =
    [
        ...new Set(
            allRows.map(
                row =>
                    row.category
            )
        )
    ]
        .sort();


// ============================================================
// TABLE CONSISTENCY
// ============================================================

const categoryConsistency =
    {};


for (
    const category
    of categories
) {

    const signatureMap =
        new Map();


    let heroesWithCategory =
        0;


    for (
        const hero
        of selectableHeroes
    ) {

        const rows =
            hero.mapModCostBonuses
                .filter(
                    row =>
                        row.category ===
                        category
                )
                .map(
                    row => ({
                        goldThreshold:
                            row.goldThreshold,

                        bonus:
                            row.bonus,

                        percentOnGraph:
                            row.percentOnGraph
                    })
                )
                .sort(
                    (
                        a,
                        b
                    ) =>
                        (
                            a.goldThreshold
                            ??
                            0
                        )
                        -
                        (
                            b.goldThreshold
                            ??
                            0
                        )
                );


        if (
            rows.length ===
            0
        ) {

            continue;
        }


        heroesWithCategory++;


        const signature =
            JSON.stringify(
                rows
            );


        if (
            !signatureMap.has(
                signature
            )
        ) {

            signatureMap.set(
                signature,
                []
            );
        }


        signatureMap.get(
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


    categoryConsistency[
        category
    ] =
        {
            heroesWithCategory,

            uniqueTableCount:
                signatureMap.size,

            universalAcrossSelectableHeroes:
                heroesWithCategory ===
                selectableHeroes.length
                &&
                signatureMap.size ===
                1,

            tables:
                [
                    ...signatureMap.entries()
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


// ============================================================
// CANONICAL-CANDIDATE TABLES
//
// "canonicalCandidate" means:
// identical in every selectable hero in THIS installed build.
//
// It is still version-bound rather than globally canonical.
// ============================================================

const universalTables =
    {};


for (
    const [
        category,
        row
    ]
    of Object.entries(
        categoryConsistency
    )
) {

    if (
        !row.universalAcrossSelectableHeroes
        ||
        row.tables.length !==
        1
    ) {

        continue;
    }


    universalTables[
        category
    ] =
        row.tables[
            0
        ].rows;
}


// ============================================================
// COMPARE WITH V01 m_mapPurchaseBonuses
// ============================================================

const v01PurchaseBonusSummary =
    {
        rows:
            v01?.counts?.purchaseBonusRows
            ??
            null,

        categories:
            v01.purchaseBonusCategories
            ??
            {},

        interpretationCorrection:
            'm_mapPurchaseBonuses is retained as a separate tier-based purchase-bonus structure and is no longer labeled as the gold-investment breakpoint table.'
    };


// ============================================================
// EXPECTED CORE CATEGORY PRESENCE
// ============================================================

const coreCategories =
    [
        'WEAPON',
        'VITALITY',
        'SPIRIT'
    ];


const missingCoreCategories =
    coreCategories.filter(
        category =>
            !Object.prototype.hasOwnProperty.call(
                categoryConsistency,
                category
            )
    );


// ============================================================
// VALIDATION
// ============================================================

const validationChecks =
    {
        v01Ready:
            check(
                v01.status,
                'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION',
                true
            ),


        selectableHeroCountPreserved:
            check(
                selectableHeroes.length,
                v01?.counts?.selectableHeroes,
                selectableHeroes.length ===
                v01?.counts?.selectableHeroes
            ),


        mapModCostBonusRowsAvailable:
            check(
                allRows.length,
                '>0',
                allRows.length >
                0
            ),


        weaponVitalitySpiritPresent:
            check(
                missingCoreCategories.length,
                0,
                missingCoreCategories.length ===
                0
            ),


        goldThresholdValuesPresent:
            check(
                allRows.filter(
                    row =>
                        Number.isFinite(
                            row.goldThreshold
                        )
                ).length,
                allRows.length,
                allRows.length >
                0
                &&
                allRows.every(
                    row =>
                        Number.isFinite(
                            row.goldThreshold
                        )
                )
            ),


        bonusValuesPresent:
            check(
                allRows.filter(
                    row =>
                        Number.isFinite(
                            row.bonus
                        )
                ).length,
                allRows.length,
                allRows.length >
                0
                &&
                allRows.every(
                    row =>
                        Number.isFinite(
                            row.bonus
                        )
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


// ============================================================
// STATUS
// ============================================================

const status =
    validationPass
        ? 'HERO_CATEGORY_GOLD_THRESHOLD_PROGRESSION_SCHEMA_READY'
        : 'HERO_CATEGORY_GOLD_THRESHOLD_PROGRESSION_SCHEMA_REQUIRES_DIAGNOSIS';


const nextStage =
    validationPass
        ? 'DISCOVER_ALL_STAT_MODIFIER_SOURCES_ITEMS_PERMANENT_BUFFS_POWERUPS_ABILITIES_AND_EXTERNAL_EFFECTS'
        : 'DIAGNOSE_MAP_MOD_COST_BONUS_PARSE';


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

        supersedesInterpretationOf:
            'Script131 V01 category-investment labeling only',

        correction:
            {
                v01Structure:
                    'm_mapPurchaseBonuses',

                v01PriorLabel:
                    'category investment / purchase bonus schema',

                v02CorrectedLabel:
                    'tier-based purchase bonus structure',

                goldThresholdStructure:
                    'm_MapModCostBonuses',

                goldThresholdFields:
                    [
                        'nGoldThreshold',
                        'flBonus',
                        'flPercentOnGraph'
                    ]
            },

        source:
            {
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
                    SOURCE2VIEWER_PATH
            },

        counts:
            {
                heroIdRecords:
                    heroes.length,

                selectableHeroes:
                    selectableHeroes.length,

                mapModCostBonusRows:
                    allRows.length,

                categories:
                    categories.length
            },

        categories,

        categoryConsistency,

        universalTables,

        tierPurchaseBonusStructureFromV01:
            v01PurchaseBonusSummary,

        heroes:
            selectableHeroes,

        validation:
            {
                pass:
                    validationPass,

                checks:
                    validationChecks
            },

        interpretation:
            {
                structuralEvidence:
                    'm_MapModCostBonuses contains explicit gold thresholds and bonus values, making it the stronger resource candidate for cumulative category-investment breakpoint mechanics.',

                versionBound:
                    'Tables are tied to the installed Deadlock build and should not be treated as permanent cross-patch constants.',

                universalMeaning:
                    'A table identical across all 42 selectable heroes supports a shared category-progression rule in this installed build.',

                distinctFromItems:
                    'These category progression bonuses are separate from the individual stat properties of the items that generated the category investment.',

                distinctFromEffectiveStats:
                    'Effective PlayerState(t) still requires current category investment plus items, permanent buffs, temporary buffs, hero scaling, ability states and debuffs.'
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
    'CATEGORY GOLD-THRESHOLD PROGRESSION'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    `Selectable heroes: ${selectableHeroes.length}`
);

console.log(
    `Parsed rows:       ${allRows.length}`
);

console.log('');


// ============================================================
// TABLES
// ============================================================

for (
    const category
    of categories
) {

    const consistency =
        categoryConsistency[
            category
        ];


    console.log(
        `${category}`
    );

    console.log(
        '-'.repeat(
            category.length
        )
    );


    console.log(
        `heroes=${consistency.heroesWithCategory}/${selectableHeroes.length}`
    );

    console.log(
        `uniqueTables=${consistency.uniqueTableCount}`
    );

    console.log(
        `universal=${consistency.universalAcrossSelectableHeroes}`
    );

    console.log('');


    for (
        let tableIndex =
            0;

        tableIndex <
            consistency.tables.length;

        tableIndex++
    ) {

        const table =
            consistency.tables[
                tableIndex
            ];


        console.log(
            `TABLE ${tableIndex + 1} heroes=${table.heroes.length}`
        );


        console.log(
            'goldThreshold   bonus          percentOnGraph'
        );


        for (
            const row
            of table.rows
        ) {

            console.log(
                `${formatNumber(row.goldThreshold).padEnd(15)} ` +
                `${formatNumber(row.bonus).padEnd(14)} ` +
                `${formatNumber(row.percentOnGraph)}`
            );
        }


        console.log('');
    }
}


// ============================================================
// V01 DISTINCTION
// ============================================================

console.log(
    '========================================================'
);

console.log(
    'DISTINCT PROGRESSION STRUCTURES'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    'm_mapPurchaseBonuses'
);

console.log(
    '  fields: m_ValueType / m_nTier / m_strValue'
);

console.log(
    `  V01 rows: ${v01?.counts?.purchaseBonusRows ?? 'n/a'}`
);

console.log(
    '  interpretation: TIER-BASED PURCHASE BONUS STRUCTURE'
);

console.log('');

console.log(
    'm_MapModCostBonuses'
);

console.log(
    '  fields: nGoldThreshold / flBonus / flPercentOnGraph'
);

console.log(
    `  V02 rows: ${allRows.length}`
);

console.log(
    '  interpretation: GOLD-THRESHOLD PROGRESSION CANDIDATE'
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
// MAP MOD COST BONUS PARSER
// ============================================================

function parseMapModCostBonuses(
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


        const category =
            normalizeCategory(
                categoryEntry.key
            );


        let bodies =
            extractObjectBodies(
                categoryEntry.inner
            );


        if (
            bodies.length ===
            0
            &&
            categoryEntry.type ===
            'object'
        ) {

            bodies =
                [
                    categoryEntry.inner
                ];
        }


        for (
            const body
            of bodies
        ) {

            const values =
                parseFlatScalarMap(
                    body
                );


            const goldThreshold =
                finite(
                    values.nGoldThreshold
                    ??
                    values.m_nGoldThreshold
                );


            const bonus =
                finite(
                    values.flBonus
                    ??
                    values.m_flBonus
                );


            const percentOnGraph =
                finite(
                    values.flPercentOnGraph
                    ??
                    values.m_flPercentOnGraph
                );


            if (
                goldThreshold ===
                null
                &&
                bonus ===
                null
                &&
                percentOnGraph ===
                null
            ) {

                continue;
            }


            rows.push(
                {
                    rawCategory:
                        categoryEntry.key,

                    category,

                    goldThreshold,

                    bonus,

                    percentOnGraph,

                    raw:
                        values
                }
            );
        }
    }


    return rows;
}


// ============================================================
// CATEGORY NORMALIZATION
// ============================================================

function normalizeCategory(
    value
) {

    const lower =
        String(
            value
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
        value
        ??
        'UNRESOLVED'
    );
}


// ============================================================
// BALANCED FIELD BLOCK
// ============================================================

function extractBalancedFieldBlock(
    text,
    fieldName
) {

    const escaped =
        escapeRegex(
            fieldName
        );


    const match =
        new RegExp(
            `${escaped}\\s*=\\s*\\{`,
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
// TOP-LEVEL ENTRIES
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
            key.end;


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

                inner:
                    null,

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
// OBJECT BODIES
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
// FLAT MAP
// ============================================================

function parseFlatScalarMap(
    text
) {

    const result =
        {};


    for (
        const entry
        of parseTopLevelEntries(
            text
        )
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
// LOW-LEVEL
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
        /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(
            value
        )
    ) {

        return Number(
            value
        );
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
// FIELD HELPERS
// ============================================================

function captureBoolean(
    text,
    fieldName
) {

    const match =
        text.match(
            new RegExp(
                `${escapeRegex(fieldName)}\\s*=\\s*(true|false|0|1)`,
                'i'
            )
        );


    if (
        !match
    ) {

        return null;
    }


    return (
        match[
            1
        ].toLowerCase() ===
        'true'
        ||
        match[
            1
        ] ===
        '1'
    );
}


// ============================================================
// GENERIC
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
        '# Hero Stat / Progression Schema Discovery V02'
    );

    lines.push('');

    lines.push(
        `Status: **${summary.status}**`
    );

    lines.push('');

    lines.push(
        '## Correction'
    );

    lines.push('');

    lines.push(
        '`m_mapPurchaseBonuses` and `m_MapModCostBonuses` are distinct resource structures.'
    );

    lines.push('');

    lines.push(
        '`m_MapModCostBonuses` contains explicit gold thresholds (`nGoldThreshold`) and bonus values (`flBonus`), so it is the stronger structural candidate for cumulative Weapon/Vitality/Spirit investment breakpoints.'
    );

    lines.push('');

    lines.push(
        '## Gold-threshold tables'
    );

    lines.push('');


    for (
        const [
            category,
            rows
        ]
        of Object.entries(
            summary.universalTables
        )
    ) {

        lines.push(
            `### ${category}`
        );

        lines.push('');

        lines.push(
            '| Gold threshold | Bonus | Graph % |'
        );

        lines.push(
            '|---:|---:|---:|'
        );


        for (
            const row
            of rows
        ) {

            lines.push(
                `| ${row.goldThreshold} | ${row.bonus} | ${row.percentOnGraph} |`
            );
        }


        lines.push('');
    }


    lines.push(
        '## Guardrail'
    );

    lines.push('');

    lines.push(
        'These are installed-build progression structures. Effective player stats still require the player’s current category investment, item properties, hero progression, permanent buffs, temporary buffs, ability/passive state and debuffs.'
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