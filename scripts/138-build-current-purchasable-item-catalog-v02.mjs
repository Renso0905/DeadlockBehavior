import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
    extractKv3Root,
    parseTopLevelEntries,
    parseFlatScalarMap,
    parseNumericArray,
    extractAssignmentFieldNames
} from '../src/vdata/kv3-parser.mjs';

const VERSION = 'CURRENT_PURCHASABLE_ITEM_CATALOG_V02';

// ============================================================
// PURPOSE
//
// Script137 established a broad ~item-like cohort but explicitly
// did NOT equate that cohort with the current purchasable shop.
// It also showed that the per-record item-cost candidate was 0
// for every row, so that field is not current shop-price authority.
//
// Script138 narrows the installed-build resource substrate using:
//
//   - explicit item source/type
//   - valid shop slot
//   - valid item tier
//   - explicit shop presentation evidence
//   - explicit disabled/development exclusions
//   - generic_data.m_nItemPricePerTier as tier-price authority
//
// V02 corrects two V01 interpretation problems:
//
//   1. EModTier_5 is a Street Brawl branch in this build, not a
//      fifth standard Curiosity Shop tier. The global 9999 entry
//      is preserved as a resource value but is not treated as a
//      standard-shop price.
//
//   2. The 28 V01 unresolved rows decompose cleanly into item-system
//      infrastructure/templates and cosmetic records.
//
// V02 therefore separates:
//
//   STANDARD_SHOP_PURCHASABLE_STRONG_RESOURCE_EVIDENCE
//   NON_STANDARD_MODE_ITEM
//   ITEM_SYSTEM_INFRASTRUCTURE
//   COSMETIC_ITEM
//   EXCLUDED_EXPLICIT_RESOURCE_EVIDENCE
//   STRUCTURAL_ITEM_UNRESOLVED
//
// This is a VERSION-BOUND RESOURCE CONTRACT, not replay ownership.
// It does not claim that a player owned any item at any time.
// ============================================================

const SOURCE2VIEWER_PATH = resolve('tools', 'source2viewer', 'Source2Viewer-CLI.exe');
const SCRIPT137_PATH = resolve('output', 'cross_replay', 'shop_item_schema_and_eligibility_discovery_v01.json');
const ABILITIES_RESOURCE = 'scripts/abilities.vdata_c';
const GENERIC_DATA_RESOURCE = 'scripts/generic_data.vdata_c';
const OUTPUT_JSON_PATH = resolve('output', 'cross_replay', 'current_purchasable_item_catalog_v02.json');

const VALID_SLOTS = new Set([
    'EItemSlotType_WeaponMod',
    'EItemSlotType_Armor',
    'EItemSlotType_Tech'
]);

const STANDARD_SHOP_TIERS = new Set([1, 2, 3, 4]);

const ITEM_INFRASTRUCTURE_KEYS = new Set([
    'ability_item_pickup_effects',
    'upgrade_base',
    'tier1_base',
    'tier2_base',
    'tier3_base',
    'tier4_base',
    'tier5_base',
    'armor_upgrade_base',
    'armor_upgrade_t1',
    'armor_upgrade_t2',
    'armor_upgrade_t3',
    'armor_upgrade_t4',
    'armor_upgrade_t5',
    'weapon_upgrade_base',
    'weapon_upgrade_t1',
    'weapon_upgrade_t2',
    'weapon_upgrade_t3',
    'weapon_upgrade_t4',
    'weapon_upgrade_t5',
    'tech_upgrade_base',
    'tech_upgrade_t1',
    'tech_upgrade_t2',
    'tech_upgrade_t3',
    'tech_upgrade_t4',
    'tech_upgrade_t5'
]);

const RELATION_FIELD_REGEX = /(upgrade|component|parent|child|base|require|prereq|from|into)/i;

const installCandidates = [
    process.env.DEADLOCK_CITADEL_DIR
        ? resolve(process.env.DEADLOCK_CITADEL_DIR, 'pak01_dir.vpk')
        : null,
    'G:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
    'C:\\Program Files\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
    'D:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
    'E:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
    'F:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk'
].filter(Boolean);

if (!existsSync(SOURCE2VIEWER_PATH)) {
    throw new Error(`Source2Viewer CLI not found:\n${SOURCE2VIEWER_PATH}`);
}

if (!existsSync(SCRIPT137_PATH)) {
    throw new Error(`Missing Script137 output:\n${SCRIPT137_PATH}`);
}

const script137 = JSON.parse(readFileSync(SCRIPT137_PATH, 'utf8'));
if (script137?.status !== 'SHOP_ITEM_SCHEMA_AND_ELIGIBILITY_SUBSTRATE_READY') {
    throw new Error(`Script137 foundation not ready. Status=${script137?.status}`);
}

const pakPath = installCandidates.find(path => existsSync(path)) ?? null;
if (!pakPath) {
    throw new Error([
        'Could not locate Deadlock pak01_dir.vpk.',
        '',
        ...installCandidates.map(path => `  ${path}`)
    ].join('\n'));
}

console.log('');
console.log('========================================================');
console.log('CURRENT PURCHASABLE ITEM CATALOG V0.2');
console.log('========================================================');
console.log('');
console.log(`Deadlock VPK: ${pakPath}`);
console.log(`Abilities:    ${ABILITIES_RESOURCE}`);
console.log(`Generic data: ${GENERIC_DATA_RESOURCE}`);
console.log('Replay parse: NONE');
console.log('');

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'deadlock-item-catalog-v02-'));

try {
    const abilities = extractSingleResource({
        source2ViewerPath: SOURCE2VIEWER_PATH,
        pakPath,
        resourcePath: ABILITIES_RESOURCE,
        temporaryDirectory
    });
    const genericData = extractSingleResource({
        source2ViewerPath: SOURCE2VIEWER_PATH,
        pakPath,
        resourcePath: GENERIC_DATA_RESOURCE,
        temporaryDirectory
    });

    if (!abilities.success || !genericData.success) {
        throw new Error(`Resource extraction failed. abilities=${abilities.success} genericData=${genericData.success}`);
    }

    const abilitiesBuffer = readFileSync(abilities.localPath);
    const genericDataBuffer = readFileSync(genericData.localPath);
    const abilitiesText = abilitiesBuffer.toString('utf8');
    const genericDataText = genericDataBuffer.toString('utf8');

    const abilitiesRoot = extractKv3Root(abilitiesText);
    const genericRoot = extractKv3Root(genericDataText);
    if (!abilitiesRoot || !genericRoot) {
        throw new Error(`KV3 root missing. abilities=${Boolean(abilitiesRoot)} genericData=${Boolean(genericRoot)}`);
    }

    const abilityEntries = parseTopLevelEntries(abilitiesRoot.inner);
    const abilityRecords = abilityEntries
        .filter(entry => entry.type === 'object')
        .map(entry => ({ recordKey: entry.key, recordText: entry.inner }));

    const genericEntries = parseTopLevelEntries(genericRoot.inner);
    const tierPriceEntry = genericEntries.find(entry => entry.key === 'm_nItemPricePerTier') ?? null;
    const tierPriceResolution = resolveTierPriceTable(tierPriceEntry);

    const recordKeySet = new Set(abilityRecords.map(row => row.recordKey));
    const analyzed = abilityRecords.map(record => analyzeRecord(record, recordKeySet, tierPriceResolution.priceByTier));

    const structuralItemCandidates = analyzed.filter(row => row.structuralItemCandidate);
    const purchasable = structuralItemCandidates.filter(row => row.eligibility.classification === 'STANDARD_SHOP_PURCHASABLE_STRONG_RESOURCE_EVIDENCE');
    const nonStandardModeItems = structuralItemCandidates.filter(row => row.eligibility.classification === 'NON_STANDARD_MODE_ITEM');
    const infrastructure = structuralItemCandidates.filter(row => row.eligibility.classification === 'ITEM_SYSTEM_INFRASTRUCTURE');
    const cosmetics = structuralItemCandidates.filter(row => row.eligibility.classification === 'COSMETIC_ITEM');
    const excluded = structuralItemCandidates.filter(row => row.eligibility.classification === 'EXCLUDED_EXPLICIT_RESOURCE_EVIDENCE');
    const unresolved = structuralItemCandidates.filter(row => row.eligibility.classification === 'STRUCTURAL_ITEM_UNRESOLVED');

    const catalogBySlot = groupCount(purchasable, row => row.itemSlot);
    const catalogByTier = groupCount(purchasable, row => String(row.itemTier));
    const nonStandardByRequirement = groupCount(nonStandardModeItems, row => row.requirements.abilityRequirements ?? 'UNRESOLVED');
    const excludedByReason = countMany(excluded, row => row.eligibility.exclusionReasons);
    const unresolvedByReason = countMany(unresolved, row => row.eligibility.unresolvedReasons);

    const presentedStructuralRows = structuralItemCandidates.filter(row => row.eligibility.shopPresentationEvidence);
    const presentedUnclassified = presentedStructuralRows.filter(row => row.eligibility.classification === 'STRUCTURAL_ITEM_UNRESOLVED');

    const catalogKeys = new Set(purchasable.map(row => row.recordKey));
    const catalog = purchasable.map(row => ({
        ...row,
        relation: {
            ...row.relation,
            catalogReferences: row.relation.recordReferences.filter(key => catalogKeys.has(key))
        }
    }));

    const validationChecks = {
        script137FoundationReady: check(
            script137.status,
            'SHOP_ITEM_SCHEMA_AND_ELIGIBILITY_SUBSTRATE_READY',
            true
        ),
        abilitiesRecordsParsed: check(abilityRecords.length, '>500', abilityRecords.length > 500),
        tierPriceTableResolved: check(
            tierPriceResolution.priceByTier,
            'five positive resource tier values',
            [1, 2, 3, 4, 5].every(tier => Number.isFinite(tierPriceResolution.priceByTier[tier]) && tierPriceResolution.priceByTier[tier] > 0)
        ),
        standardTierPricesResolved: check(
            Object.fromEntries([1, 2, 3, 4].map(tier => [tier, tierPriceResolution.priceByTier[tier]])),
            'positive prices for standard tiers 1-4',
            [1, 2, 3, 4].every(tier => Number.isFinite(tierPriceResolution.priceByTier[tier]) && tierPriceResolution.priceByTier[tier] > 0)
        ),
        structuralCandidatesFound: check(structuralItemCandidates.length, '>100', structuralItemCandidates.length > 100),
        strongCatalogFound: check(catalog.length, '>100', catalog.length > 100),
        catalogHasThreeSlots: check(Object.keys(catalogBySlot).length, 3, Object.keys(catalogBySlot).length === 3),
        catalogRowsHavePrices: check(
            catalog.filter(row => Number.isFinite(row.standardShopPrice) && row.standardShopPrice > 0).length,
            catalog.length,
            catalog.every(row => Number.isFinite(row.standardShopPrice) && row.standardShopPrice > 0)
        ),
        noExplicitDisabledCatalogRows: check(
            catalog.filter(row => row.flags.disabled === true).length,
            0,
            catalog.every(row => row.flags.disabled !== true)
        ),
        noExplicitDevelopmentCatalogRows: check(
            catalog.filter(row => row.flags.inDevelopment === true).length,
            0,
            catalog.every(row => row.flags.inDevelopment !== true)
        ),
        allCatalogRowsShopPresented: check(
            catalog.filter(row => row.eligibility.shopPresentationEvidence).length,
            catalog.length,
            catalog.every(row => row.eligibility.shopPresentationEvidence)
        ),
        standardCatalogUsesOnlyTiersOneThroughFour: check(
            catalog.filter(row => STANDARD_SHOP_TIERS.has(row.itemTier)).length,
            catalog.length,
            catalog.every(row => STANDARD_SHOP_TIERS.has(row.itemTier))
        ),
        noStreetBrawlRowsInStandardCatalog: check(
            catalog.filter(row => row.requirements.streetBrawlOnly).length,
            0,
            catalog.every(row => !row.requirements.streetBrawlOnly)
        ),
        streetBrawlBranchFoundAndSeparated: check(
            nonStandardModeItems.length,
            '>0',
            nonStandardModeItems.length > 0 && nonStandardModeItems.every(row => row.requirements.streetBrawlOnly)
        ),
        noCosmeticsInStandardCatalog: check(
            catalog.filter(row => row.identity.abilityType === 'EAbilityType_Cosmetic').length,
            0,
            catalog.every(row => row.identity.abilityType !== 'EAbilityType_Cosmetic')
        ),
        noStructuralRowsLeftUnresolved: check(
            unresolved.length,
            0,
            unresolved.length === 0
        ),
        noPresentedRowsLeftUnclassified: check(
            presentedUnclassified.length,
            0,
            presentedUnclassified.length === 0
        )
    };

    const validationPass = Object.values(validationChecks).every(row => row.pass);
    const status = validationPass
        ? 'CURRENT_PURCHASABLE_ITEM_CATALOG_V02_STANDARD_SHOP_RESOURCE_READY'
        : 'CURRENT_PURCHASABLE_ITEM_CATALOG_V02_REQUIRES_DIAGNOSIS';

    const output = {
        version: VERSION,
        canonical: false,
        versionBoundToInstalledBuild: true,
        createdAt: new Date().toISOString(),
        status,
        supersedes: {
            artifact: 'current_purchasable_item_catalog_v01.json',
            reason: 'V01 mixed Street Brawl tier-5 records into the standard shop and left item-system infrastructure/cosmetics unresolved.'
        },
        source: {
            method: 'LOCAL_INSTALLED_ABILITIES_AND_GENERIC_DATA_VDATA',
            pakPath,
            abilitiesResource: ABILITIES_RESOURCE,
            abilitiesBytes: abilitiesBuffer.length,
            abilitiesSha256: sha256(abilitiesBuffer),
            genericDataResource: GENERIC_DATA_RESOURCE,
            genericDataBytes: genericDataBuffer.length,
            genericDataSha256: sha256(genericDataBuffer),
            script137Path: SCRIPT137_PATH,
            script137Status: script137.status
        },
        priceContract: {
            sourceField: 'm_nItemPricePerTier',
            sourceEntryType: tierPriceEntry?.type ?? null,
            rawValues: tierPriceResolution.rawValues,
            resourceValueByTier: tierPriceResolution.priceByTier,
            standardShopPriceByTier: Object.fromEntries([1, 2, 3, 4].map(tier => [tier, tierPriceResolution.priceByTier[tier]])),
            tier5ResourceValue: tierPriceResolution.priceByTier[5] ?? null,
            interpretation: 'Standard Curiosity Shop price authority uses installed-build tiers 1-4. Tier 5 is retained as a resource branch but excluded from the standard catalog when ERequirementStreetBrawl is present; the 9999 value is not promoted as a normal standard-shop price.'
        },
        counts: {
            topLevelAbilityObjectRecords: abilityRecords.length,
            structuralItemCandidates: structuralItemCandidates.length,
            standardShopPurchasableStrongResourceEvidence: catalog.length,
            nonStandardModeItems: nonStandardModeItems.length,
            itemSystemInfrastructure: infrastructure.length,
            cosmeticItems: cosmetics.length,
            excludedExplicitResourceEvidence: excluded.length,
            structuralItemUnresolved: unresolved.length,
            shopPresentedStructuralRows: presentedStructuralRows.length,
            shopPresentedRowsLeftUnclassified: presentedUnclassified.length
        },
        catalogSummary: {
            bySlot: catalogBySlot,
            byTier: catalogByTier
        },
        nonStandardModeSummary: nonStandardByRequirement,
        excludedSummary: excludedByReason,
        unresolvedSummary: unresolvedByReason,
        catalog,
        nonStandardModeItems,
        infrastructure,
        cosmetics,
        excluded,
        unresolved,
        interpretation: {
            catalogMeaning: 'Rows in catalog are standard Curiosity Shop items with explicit installed-resource evidence for item identity, valid Weapon/Vitality/Spirit slot, standard tier 1-4, shop presentation, and no explicit exclusion.',
            priceMeaning: 'Standard shop price is tier-derived from generic_data.m_nItemPricePerTier tiers 1-4 for this installed build.',
            streetBrawlMeaning: 'm_eAbilityRequirements containing ERequirementStreetBrawl is explicit non-standard-mode evidence; these records are preserved separately and never promoted into the standard catalog.',
            tier5Meaning: 'EModTier_5 belongs to the Street Brawl/non-standard branch observed in this build. Its global resource value 9999 is preserved diagnostically but not interpreted as a normal standard-shop price.',
            infrastructureMeaning: 'Known upgrade/tier/category base records and ability_item_pickup_effects are item-system scaffolding, not purchasable shop rows.',
            cosmeticMeaning: 'EAbilityType_Cosmetic rows are kept outside the gameplay item catalog even when they carry shop presentation assets.',
            notReplayOwnership: 'Catalog membership does not establish that any replay player owned the item at any time.',
            disabledSemantics: 'm_bDisabled=true or m_bInDevelopment=true is treated as explicit exclusion. Absence of those fields is not treated as positive evidence by itself.',
            presentationSemantics: 'A non-empty m_strShopIconLarge is used as the primary explicit standard-shop presentation signal after mode, cosmetic, infrastructure and disabled/development exclusions are applied.',
            relations: 'Exact references to other abilities.vdata record keys are preserved as relation substrate; they are not yet labeled component/upgrade semantics unless the field itself establishes that meaning.'
        },
        validation: {
            pass: validationPass,
            checks: validationChecks
        },
        nextStage: validationPass
            ? 'RESOLVE_STANDARD_ITEM_EFFECT_CONTRACTS_AND_THEN_REPLAY_ITEM_OWNERSHIP_LIFECYCLE'
            : 'DIAGNOSE_FAILED_PRICE_OR_ELIGIBILITY_CONTRACT',
        output: OUTPUT_JSON_PATH
    };

    mkdirSync(dirname(OUTPUT_JSON_PATH), { recursive: true });
    writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(output, null, 2), 'utf8');

    console.log('========================================================');
    console.log('CATALOG RESULT');
    console.log('========================================================');
    console.log('');
    console.log(`status:       ${status}`);
    console.log(`abilities:    ${abilityRecords.length}`);
    console.log(`structural:   ${structuralItemCandidates.length}`);
    console.log(`standard:     ${catalog.length}`);
    console.log(`street brawl:${String(nonStandardModeItems.length).padStart(4)}`);
    console.log(`infrastructure:${String(infrastructure.length).padStart(2)}`);
    console.log(`cosmetics:    ${cosmetics.length}`);
    console.log(`excluded:     ${excluded.length}`);
    console.log(`unresolved:   ${unresolved.length}`);
    console.log(`resource tiers:${JSON.stringify(tierPriceResolution.priceByTier)}`);
    console.log(`standard prices:${JSON.stringify(Object.fromEntries([1,2,3,4].map(tier => [tier, tierPriceResolution.priceByTier[tier]])))}`);
    console.log(`by slot:      ${JSON.stringify(catalogBySlot)}`);
    console.log(`by tier:      ${JSON.stringify(catalogByTier)}`);
    console.log('');
    console.log(`JSON:\n${OUTPUT_JSON_PATH}`);
    console.log('');
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}

function analyzeRecord(record, recordKeySet, priceByTier) {
    const top = parseFlatScalarMap(record.recordText);
    const sourceName = top.m_strAG2SourceName ?? null;
    const abilityType = top.m_eAbilityType ?? null;
    const itemSlot = top.m_eItemSlotType ?? null;
    const itemTier = normalizeTier(top.m_iItemTier ?? top.m_nItemTier ?? top.m_iTier ?? null);
    const disabled = normalizeBoolean(top.m_bDisabled);
    const inDevelopment = normalizeBoolean(top.m_bInDevelopment);
    const shopIconLarge = normalizeResourceString(top.m_strShopIconLarge);
    const shopFilters = top.m_eShopFilters ?? null;
    const abilityRequirements = top.m_eAbilityRequirements ?? null;

    const streetBrawlOnly = String(abilityRequirements ?? '').includes('ERequirementStreetBrawl');
    const cosmetic = abilityType === 'EAbilityType_Cosmetic';
    const infrastructureEvidence = ITEM_INFRASTRUCTURE_KEYS.has(record.recordKey) && !shopIconLarge;

    const structuralReasons = [];
    if (String(sourceName ?? '').toLowerCase() === 'item') structuralReasons.push('AG2_SOURCE_ITEM');
    if (abilityType === 'EAbilityType_Item') structuralReasons.push('ABILITY_TYPE_ITEM');
    if (abilityType === 'EAbilityType_Cosmetic') structuralReasons.push('ABILITY_TYPE_COSMETIC');
    if (VALID_SLOTS.has(itemSlot)) structuralReasons.push('VALID_ITEM_SLOT');
    if (Number.isInteger(itemTier) && itemTier >= 1 && itemTier <= 5) structuralReasons.push('VALID_ITEM_TIER');
    if (/^upgrade_/i.test(record.recordKey)) structuralReasons.push('UPGRADE_RECORD_KEY');

    const structuralItemCandidate = structuralReasons.length > 0;
    const shopPresentationEvidence = Boolean(shopIconLarge);
    const exclusionReasons = [];
    const unresolvedReasons = [];

    if (disabled === true) exclusionReasons.push('EXPLICIT_DISABLED');
    if (inDevelopment === true) exclusionReasons.push('EXPLICIT_IN_DEVELOPMENT');
    if (itemSlot === 'EItemSlotType_Invalid') exclusionReasons.push('INVALID_ITEM_SLOT');

    const coreStandardShopIdentity =
        String(sourceName ?? '').toLowerCase() === 'item'
        && abilityType === 'EAbilityType_Item'
        && VALID_SLOTS.has(itemSlot)
        && STANDARD_SHOP_TIERS.has(itemTier)
        && !streetBrawlOnly;

    if (!coreStandardShopIdentity && !streetBrawlOnly && !cosmetic && !infrastructureEvidence) {
        if (String(sourceName ?? '').toLowerCase() !== 'item') unresolvedReasons.push('NO_EXPLICIT_ITEM_SOURCE');
        if (abilityType !== 'EAbilityType_Item') unresolvedReasons.push('NO_EXPLICIT_ITEM_ABILITY_TYPE');
        if (!VALID_SLOTS.has(itemSlot)) unresolvedReasons.push('NO_VALID_SHOP_SLOT');
        if (!STANDARD_SHOP_TIERS.has(itemTier)) {
            unresolvedReasons.push(itemTier === 5
                ? 'TIER5_WITHOUT_EXPLICIT_STREET_BRAWL_REQUIREMENT'
                : 'NO_VALID_STANDARD_ITEM_TIER');
        }
    }
    if (!shopPresentationEvidence && !streetBrawlOnly && !cosmetic && !infrastructureEvidence) {
        unresolvedReasons.push('NO_EXPLICIT_LARGE_SHOP_ICON');
    }

    let classification;
    if (streetBrawlOnly) {
        classification = 'NON_STANDARD_MODE_ITEM';
    } else if (cosmetic) {
        classification = 'COSMETIC_ITEM';
    } else if (infrastructureEvidence) {
        classification = 'ITEM_SYSTEM_INFRASTRUCTURE';
    } else if (exclusionReasons.length > 0) {
        classification = 'EXCLUDED_EXPLICIT_RESOURCE_EVIDENCE';
    } else if (coreStandardShopIdentity && shopPresentationEvidence) {
        classification = 'STANDARD_SHOP_PURCHASABLE_STRONG_RESOURCE_EVIDENCE';
    } else {
        classification = 'STRUCTURAL_ITEM_UNRESOLVED';
    }

    const relationFieldNames = extractAssignmentFieldNames(record.recordText)
        .filter(fieldName => RELATION_FIELD_REGEX.test(fieldName));
    const recordReferences = [...extractRecordReferences(record.recordText, recordKeySet)]
        .filter(key => key !== record.recordKey)
        .sort();

    return {
        recordKey: record.recordKey,
        structuralItemCandidate,
        structuralReasons,
        itemSlot,
        itemTier,
        standardShopPrice: STANDARD_SHOP_TIERS.has(itemTier) ? priceByTier[itemTier] ?? null : null,
        resourceTierValue: Number.isInteger(itemTier) ? priceByTier[itemTier] ?? null : null,
        flags: {
            disabled,
            inDevelopment
        },
        requirements: {
            abilityRequirements,
            streetBrawlOnly
        },
        presentation: {
            shopIconLarge,
            shopFilters
        },
        identity: {
            sourceName,
            abilityType
        },
        eligibility: {
            classification,
            shopPresentationEvidence,
            infrastructureEvidence,
            cosmetic,
            exclusionReasons,
            unresolvedReasons
        },
        relation: {
            relationFieldNames,
            recordReferences
        }
    };
}

function resolveTierPriceTable(entry) {
    if (!entry) return { rawValues: [], priceByTier: {} };

    let rawValues = [];
    if (entry.type === 'array') {
        rawValues = parseNumericArray(entry.inner);
    } else if (entry.type === 'object') {
        const flat = parseFlatScalarMap(entry.inner);
        rawValues = Object.entries(flat)
            .filter(([, value]) => Number.isFinite(value))
            .sort(([a], [b]) => numericKey(a) - numericKey(b))
            .map(([, value]) => value);
    } else {
        rawValues = parseNumericArray(entry.rawValue);
    }

    const normalized = rawValues.length >= 6 && rawValues[0] === 0
        ? rawValues.slice(1, 6)
        : rawValues.slice(0, 5);

    return {
        rawValues,
        priceByTier: Object.fromEntries(normalized.map((value, index) => [index + 1, value]))
    };
}

function extractRecordReferences(text, recordKeySet) {
    const output = new Set();
    for (const match of String(text ?? '').matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
        const token = match[0];
        if (recordKeySet.has(token)) output.add(token);
    }
    return output;
}

function normalizeTier(value) {
    if (Number.isInteger(value)) return value;
    const match = /^EModTier_(\d+)$/.exec(String(value ?? ''));
    return match ? Number(match[1]) : null;
}

function normalizeBoolean(value) {
    if (value === true || value === false) return value;
    if (value === 1 || value === '1') return true;
    if (value === 0 || value === '0') return false;
    if (String(value ?? '').toLowerCase() === 'true') return true;
    if (String(value ?? '').toLowerCase() === 'false') return false;
    return null;
}

function normalizeResourceString(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text || text === '""' || text === 'panorama:""' || text === 'panorama:\"\"') return null;
    return text;
}

function numericKey(value) {
    const match = String(value).match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function groupCount(rows, selector) {
    const map = new Map();
    for (const row of rows) {
        const key = selector(row) ?? 'UNRESOLVED';
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Object.fromEntries([...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function countMany(rows, selector) {
    const map = new Map();
    for (const row of rows) {
        for (const key of selector(row)) {
            map.set(key, (map.get(key) ?? 0) + 1);
        }
    }
    return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function check(actual, expected, pass) {
    return { actual, expected, pass: Boolean(pass) };
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function extractSingleResource({ source2ViewerPath, pakPath, resourcePath, temporaryDirectory }) {
    const safeName = resourcePath
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/_c$/, '');
    const desiredOutput = join(temporaryDirectory, safeName);

    const result = spawnSync(source2ViewerPath, [
        '--input', pakPath,
        '--vpk_filepath', resourcePath,
        '--output', desiredOutput,
        '--vpk_decompile'
    ], {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 256 * 1024 * 1024
    });

    if (result.status !== 0) {
        return { success: false, stderr: result.stderr, stdout: result.stdout };
    }

    let localPath = existsSync(desiredOutput) ? desiredOutput : null;
    if (!localPath) {
        localPath = findFileRecursive(
            temporaryDirectory,
            fileName => fileName.toLowerCase().includes(basename(safeName).toLowerCase())
        );
    }

    return { success: Boolean(localPath), localPath };
}

function findFileRecursive(directory, predicate) {
    if (!existsSync(directory)) return null;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = findFileRecursive(fullPath, predicate);
            if (nested) return nested;
        } else if (predicate(entry.name)) {
            return fullPath;
        }
    }
    return null;
}
