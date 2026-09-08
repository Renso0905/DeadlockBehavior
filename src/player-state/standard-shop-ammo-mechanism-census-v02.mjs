// Script202 V02 helpers.
//
// V01 failed integrity because it recursively collected all 285 Script138
// structural recordKeys instead of selecting the 156 records explicitly
// classified as standard-shop purchasable.
//
// V02 also respects Script139 V03's direct/non-direct distinction:
// recordModifierTokens are corroboration only and cannot by themselves promote
// a dynamic ammo mechanism.

export const STANDARD_CLASS =
  'STANDARD_SHOP_PURCHASABLE_STRONG_RESOURCE_EVIDENCE';

const AMMO_WORD =
  /(ammo|clip|magazine|reload)/i;

const CAPACITY_WORD =
  /(?:ammoclipsize|bonusclipsize|clipsize|magazinesize|maxammo)/i;

const RELOAD_SPEED_WORD =
  /(?:reloadspeed|reloadmultiplier|reloadspeedmultip)/i;

const EXPLICIT_RESTORE_WORD =
  /(?:ammoreloadpercent|activereloadpercent|procammo|bonusclipperkill|ammorestore|ammorefill|ammorefund|ammoreplenish|reloadammo|restoreammo|refillammo|refundammo|replenishammo)/i;

const DYNAMIC_METADATA_WORD =
  /(?:activereload|recharg|quicksilver|ethereal|restore|refill|refund|replenish|proc|perkill|watcher)/i;

export function collectStandardCatalogItems(catalog) {
  const rows = [];
  const seen = new WeakSet();
  const keys = new Set();

  function visit(node, path = '$') {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (
      !Array.isArray(node)
      && node.classification === STANDARD_CLASS
      && typeof node.recordKey === 'string'
    ) {
      if (!keys.has(node.recordKey)) {
        keys.add(node.recordKey);
        rows.push({
          recordKey: node.recordKey,
          path,
          object: node,
        });
      }
    }

    if (Array.isArray(node)) {
      node.forEach(
        (child, i) =>
          visit(child, `${path}[${i}]`),
      );
    } else {
      for (const [key, child] of Object.entries(node)) {
        visit(child, `${path}.${key}`);
      }
    }
  }

  visit(catalog);

  return rows.sort(
    (a, b) =>
      a.recordKey.localeCompare(b.recordKey),
  );
}

export function collectEffectItems(effects) {
  const rows = [];
  const duplicates = [];
  const seen = new WeakSet();
  const keys = new Set();

  function visit(node, path = '$') {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (
      !Array.isArray(node)
      && typeof node.recordKey === 'string'
      && (
        Array.isArray(node.directProvidedStats)
        || Array.isArray(node.meaningfulDirectProvidedStats)
        || node.weaponStateRelevant
      )
    ) {
      if (keys.has(node.recordKey)) {
        duplicates.push({
          recordKey: node.recordKey,
          path,
        });
      } else {
        keys.add(node.recordKey);
        rows.push({
          recordKey: node.recordKey,
          path,
          object: node,
        });
      }
    }

    if (Array.isArray(node)) {
      node.forEach(
        (child, i) =>
          visit(child, `${path}[${i}]`),
      );
    } else {
      for (const [key, child] of Object.entries(node)) {
        visit(child, `${path}.${key}`);
      }
    }
  }

  visit(effects);

  return {
    rows: rows.sort(
      (a, b) =>
        a.recordKey.localeCompare(b.recordKey),
    ),
    duplicates,
  };
}

export function classifyAmmoItem(item) {
  const direct =
    collectMeaningfulDirectAmmoEvidence(item);

  const separatedNonDirect =
    collectSeparatedNonDirectAmmoEvidence(item);

  const nested =
    collectNamedArrayEvidence(
      item?.nestedModifierClasses,
      'nestedModifierClasses',
      'B_NESTED_MODIFIER_NAME',
    );

  const diagnostic =
    dedupe([
      ...collectNamedArrayEvidence(
        item?.weaponStateRelevant
          ?.genericRecordFieldNamesDiagnosticOnly,
        'weaponStateRelevant.genericRecordFieldNamesDiagnosticOnly',
        'C_DIAGNOSTIC_FIELD_NAME',
      ),
      ...collectNamedArrayEvidence(
        item?.weaponStateRelevant
          ?.operation
          ?.genericRecordFieldNamesDiagnosticOnly,
        'weaponStateRelevant.operation.genericRecordFieldNamesDiagnosticOnly',
        'C_DIAGNOSTIC_FIELD_NAME',
      ),
    ]);

  const metadata =
    collectMetadataEvidence(item);

  const corroboratingRecordTokens =
    collectNamedArrayEvidence(
      item?.recordModifierTokens,
      'recordModifierTokens',
      'E_CORROBORATING_RECORD_TOKEN',
    );

  const primary =
    dedupe([
      ...direct,
      ...separatedNonDirect,
      ...nested,
      ...diagnostic,
      ...metadata,
    ]);

  const all =
    dedupe([
      ...primary,
      ...corroboratingRecordTokens,
    ]);

  const directCapacity =
    direct.filter(
      row =>
        CAPACITY_WORD.test(
          normalized(row.value),
        ),
    );

  const directReloadSpeed =
    direct.filter(
      row =>
        RELOAD_SPEED_WORD.test(
          normalized(row.value),
        ),
    );

  const explicitRestoreFields =
    primary.filter(
      row =>
        EXPLICIT_RESTORE_WORD.test(
          normalized(row.value),
        ),
    );

  const dynamicMetadata =
    metadata.filter(
      row =>
        DYNAMIC_METADATA_WORD.test(
          normalized(row.value),
        ),
    );

  const diagnosticNotExplainedByStatic =
    diagnostic.filter(row => {
      const value =
        normalized(row.value);

      const capacity =
        CAPACITY_WORD.test(value);

      const reloadSpeed =
        RELOAD_SPEED_WORD.test(value);

      if (
        capacity
        && directCapacity.length > 0
      ) {
        return false;
      }

      if (
        reloadSpeed
        && directReloadSpeed.length > 0
      ) {
        return false;
      }

      return true;
    });

  let classification =
    'NO_AMMO_MECHANISM_EVIDENCE';

  if (explicitRestoreFields.length > 0) {
    classification =
      'CURRENT_AMMO_RESTORATION_FIELD_CANDIDATE';
  } else if (
    separatedNonDirect.length > 0
    || nested.length > 0
  ) {
    classification =
      'NON_DIRECT_OR_DYNAMIC_AMMO_MECHANISM_CANDIDATE';
  } else if (
    diagnosticNotExplainedByStatic.length > 0
    || dynamicMetadata.length > 0
  ) {
    classification =
      'AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED';
  } else if (
    directCapacity.length > 0
    && directReloadSpeed.length > 0
  ) {
    classification =
      'STATIC_CAPACITY_AND_RELOAD_RATE_EFFECT';
  } else if (
    directCapacity.length > 0
  ) {
    classification =
      'STATIC_CLIP_OR_MAGAZINE_CAPACITY_EFFECT';
  } else if (
    directReloadSpeed.length > 0
  ) {
    classification =
      'STATIC_RELOAD_RATE_EFFECT';
  } else if (
    diagnostic.length > 0
    || metadata.length > 0
  ) {
    classification =
      'AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED';
  }

  return {
    recordKey:
      item?.recordKey ?? null,

    classification,

    currentAmmoCandidate:
      [
        'CURRENT_AMMO_RESTORATION_FIELD_CANDIDATE',
        'NON_DIRECT_OR_DYNAMIC_AMMO_MECHANISM_CANDIDATE',
        'AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED',
      ].includes(classification),

    staticOnly:
      [
        'STATIC_CAPACITY_AND_RELOAD_RATE_EFFECT',
        'STATIC_CLIP_OR_MAGAZINE_CAPACITY_EFFECT',
        'STATIC_RELOAD_RATE_EFFECT',
      ].includes(classification),

    evidence: {
      direct,
      separatedNonDirect,
      nested,
      diagnostic,
      diagnosticNotExplainedByStatic,
      metadata,
      dynamicMetadata,
      corroboratingRecordTokens,
      explicitRestoreFields,
      all,
    },
  };
}

export function buildCensusV02({
  catalog,
  effects,
}) {
  const standardCatalog =
    collectStandardCatalogItems(
      catalog,
    );

  const effectResult =
    collectEffectItems(
      effects,
    );

  const standardKeys =
    new Set(
      standardCatalog.map(
        row => row.recordKey,
      ),
    );

  const effectKeys =
    new Set(
      effectResult.rows.map(
        row => row.recordKey,
      ),
    );

  const missingEffects =
    [...standardKeys]
      .filter(
        key =>
          !effectKeys.has(key),
      )
      .sort();

  const extraEffects =
    [...effectKeys]
      .filter(
        key =>
          !standardKeys.has(key),
      )
      .sort();

  const effectByKey =
    new Map(
      effectResult.rows.map(
        row => [
          row.recordKey,
          row,
        ],
      ),
    );

  const items =
    standardCatalog
      .map(catalogRow => {
        const effectRow =
          effectByKey.get(
            catalogRow.recordKey,
          );

        return {
          ...classifyAmmoItem(
            effectRow?.object ?? {
              recordKey:
                catalogRow.recordKey,
            },
          ),
          catalogPath:
            catalogRow.path,
          effectPath:
            effectRow?.path ?? null,
        };
      })
      .sort(
        (a, b) =>
          classOrder(a.classification)
          - classOrder(b.classification)
          || a.recordKey.localeCompare(
            b.recordKey,
          ),
      );

  const currentAmmoCandidates =
    items.filter(
      row =>
        row.currentAmmoCandidate,
    );

  const staticOnly =
    items.filter(
      row =>
        row.staticOnly,
    );

  const none =
    items.filter(
      row =>
        row.classification
        === 'NO_AMMO_MECHANISM_EVIDENCE',
    );

  return {
    standardCatalogRows:
      standardCatalog.length,

    effectItems:
      effectResult.rows.length,

    joinedItems:
      items.length,

    duplicateEffectRecordKeys:
      effectResult.duplicates,

    missingEffects,
    extraEffects,

    byClassification:
      countBy(
        items,
        row => row.classification,
      ),

    currentAmmoCandidateCount:
      currentAmmoCandidates.length,

    staticOnlyCount:
      staticOnly.length,

    noAmmoEvidenceCount:
      none.length,

    currentAmmoCandidates,
    staticOnly,
    items,

    classification:
      standardCatalog.length === 156
      && effectResult.rows.length === 156
      && items.length === 156
      && missingEffects.length === 0
      && extraEffects.length === 0
      && effectResult.duplicates.length === 0
        ? 'COMPLETE_156_ITEM_STANDARD_SHOP_AMMO_MECHANISM_CENSUS_V02'
        : 'AMMO_MECHANISM_CENSUS_V02_INCOMPLETE',
  };
}

function collectMeaningfulDirectAmmoEvidence(item) {
  const evidence = [];

  for (
    const row
    of Array.isArray(
      item?.meaningfulDirectProvidedStats,
    )
      ? item.meaningfulDirectProvidedStats
      : []
  ) {
    const strings =
      [
        row?.propertyKey,
        row?.providedPropertyType,
        ...(Array.isArray(
          row?.modifierValueTokens,
        )
          ? row.modifierValueTokens
          : []),
      ]
        .filter(
          value =>
            typeof value === 'string',
        );

    for (const value of strings) {
      if (!AMMO_WORD.test(value)) continue;

      evidence.push({
        tier:
          'A_MEANINGFUL_DIRECT',
        source:
          'meaningfulDirectProvidedStats',
        value,
      });
    }
  }

  return dedupe(evidence);
}

function collectSeparatedNonDirectAmmoEvidence(item) {
  const value =
    item?.interpretation
      ?.nonDirectModifierTokens;

  const strings =
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];

  return strings
    .filter(
      string =>
        typeof string === 'string'
        && AMMO_WORD.test(string),
    )
    .map(
      string => ({
        tier:
          'B_SEPARATED_NON_DIRECT_TOKEN',
        source:
          'interpretation.nonDirectModifierTokens',
        value:
          string,
      }),
    );
}

function collectNamedArrayEvidence(
  value,
  source,
  tier,
) {
  const strings =
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];

  return strings
    .filter(
      string =>
        typeof string === 'string'
        && AMMO_WORD.test(string),
    )
    .map(
      string => ({
        tier,
        source,
        value:
          string,
      }),
    );
}

function collectMetadataEvidence(item) {
  const candidates = [
    [
      'recordKey',
      item?.recordKey,
    ],
    [
      'selectedTopLevelMetadata.m_strCSSClass',
      item?.selectedTopLevelMetadata
        ?.m_strCSSClass,
    ],
    [
      'selectedTopLevelMetadata.m_strShopIconLarge',
      item?.selectedTopLevelMetadata
        ?.m_strShopIconLarge,
    ],
  ];

  return candidates
    .filter(
      ([, value]) =>
        typeof value === 'string'
        && AMMO_WORD.test(value),
    )
    .map(
      ([source, value]) => ({
        tier:
          'D_NAME_OR_METADATA_ONLY',
        source,
        value,
      }),
    );
}

function dedupe(rows) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const key =
      `${row.tier}|${row.source}|${row.value}`;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

function normalized(value) {
  return String(value)
    .replace(
      /[^a-z0-9]+/gi,
      '',
    )
    .toLowerCase();
}

function countBy(
  rows,
  keyFn,
) {
  const counts = new Map();

  for (const row of rows) {
    const key =
      keyFn(row);

    counts.set(
      key,
      (counts.get(key) ?? 0) + 1,
    );
  }

  return [...counts.entries()]
    .map(
      ([key, count]) => ({
        key,
        count,
      }),
    )
    .sort(
      (a, b) =>
        classOrder(a.key)
        - classOrder(b.key)
        || a.key.localeCompare(b.key),
    );
}

function classOrder(value) {
  const order = {
    CURRENT_AMMO_RESTORATION_FIELD_CANDIDATE: 0,
    NON_DIRECT_OR_DYNAMIC_AMMO_MECHANISM_CANDIDATE: 1,
    AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED: 2,
    STATIC_CAPACITY_AND_RELOAD_RATE_EFFECT: 3,
    STATIC_CLIP_OR_MAGAZINE_CAPACITY_EFFECT: 4,
    STATIC_RELOAD_RATE_EFFECT: 5,
    NO_AMMO_MECHANISM_EVIDENCE: 6,
  };

  return order[value] ?? 99;
}
