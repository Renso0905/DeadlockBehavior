// Script202 V03 helpers.
//
// Successor to V01/V02 adapter failures.
//
// V03 uses Script139 V03's exact `items` array as the standard-shop universe.
// Script139 V03 is itself derived from the validated Script138 V02 156-item
// standard catalog and reports 156 analyzed / 0 missing catalog records.
//
// This avoids re-deriving Script138's internal catalog schema.
//
// Scientific purpose:
//   exhaustive resource-level census of current-ammo / clip / reload evidence
//   across all 156 validated standard-shop items, independent of replay
//   purchase exposure.
//
// This is resource evidence only; it does not establish runtime causality.

export const EXPECTED_EFFECT_STATUS =
  'STANDARD_SHOP_ITEM_EFFECT_SUBSTRATE_V03_READY';

const AMMO_WORD =
  /(ammo|clip|magazine|reload)/i;

const CAPACITY_WORD =
  /(?:ammoclipsize|bonusclipsize|clipsize|magazinesize|maxammo)/i;

const RELOAD_SPEED_WORD =
  /(?:reloadspeed|reloadmultiplier|reloadspeedmultip)/i;

const EXPLICIT_CURRENT_AMMO_WORD =
  /(?:ammoreloadpercent|activereloadpercent|procammo|bonusclipperkill|ammorestore|ammorefill|ammorefund|ammoreplenish|reloadammo|restoreammo|refillammo|refundammo|replenishammo)/i;

const DYNAMIC_NAME_WORD =
  /(?:activereload|recharg|quicksilver|ethereal|restore|refill|refund|replenish|proc|perkill|watcher)/i;

export function getScript139Universe(effects) {
  const items =
    Array.isArray(effects?.items)
      ? effects.items
      : [];

  const recordKeys =
    items
      .map(item => item?.recordKey)
      .filter(
        value =>
          typeof value === 'string',
      );

  const uniqueRecordKeys =
    [...new Set(recordKeys)];

  const duplicateRecordKeys =
    recordKeys
      .filter(
        (key, index) =>
          recordKeys.indexOf(key) !== index,
      )
      .filter(
        (key, index, array) =>
          array.indexOf(key) === index,
      )
      .sort();

  return {
    status:
      effects?.status ?? null,

    items,

    itemCount:
      items.length,

    recordKeyCount:
      recordKeys.length,

    uniqueRecordKeyCount:
      uniqueRecordKeys.length,

    duplicateRecordKeys,

    missingRecordKeyCount:
      items.length
      - recordKeys.length,
  };
}

export function classifyAmmoItemV03(item) {
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

  const explicitCurrentAmmo =
    primary.filter(
      row =>
        EXPLICIT_CURRENT_AMMO_WORD.test(
          normalized(row.value),
        ),
    );

  const dynamicMetadata =
    metadata.filter(
      row =>
        DYNAMIC_NAME_WORD.test(
          normalized(row.value),
        ),
    );

  const diagnosticUnexplainedByStatic =
    diagnostic.filter(row => {
      const value =
        normalized(row.value);

      if (
        CAPACITY_WORD.test(value)
        && directCapacity.length > 0
      ) {
        return false;
      }

      if (
        RELOAD_SPEED_WORD.test(value)
        && directReloadSpeed.length > 0
      ) {
        return false;
      }

      return true;
    });

  let classification =
    'NO_AMMO_MECHANISM_EVIDENCE';

  if (explicitCurrentAmmo.length > 0) {
    classification =
      'CURRENT_AMMO_FIELD_CANDIDATE';
  } else if (
    separatedNonDirect.length > 0
    || nested.length > 0
  ) {
    classification =
      'NON_DIRECT_OR_DYNAMIC_AMMO_CANDIDATE';
  } else if (
    diagnosticUnexplainedByStatic.length > 0
    || dynamicMetadata.length > 0
  ) {
    classification =
      'AMMO_RESOURCE_EVIDENCE_UNRESOLVED';
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
      'AMMO_RESOURCE_EVIDENCE_UNRESOLVED';
  }

  const currentAmmoCandidate =
    [
      'CURRENT_AMMO_FIELD_CANDIDATE',
      'NON_DIRECT_OR_DYNAMIC_AMMO_CANDIDATE',
      'AMMO_RESOURCE_EVIDENCE_UNRESOLVED',
    ].includes(classification);

  const staticOnly =
    [
      'STATIC_CAPACITY_AND_RELOAD_RATE_EFFECT',
      'STATIC_CLIP_OR_MAGAZINE_CAPACITY_EFFECT',
      'STATIC_RELOAD_RATE_EFFECT',
    ].includes(classification);

  return {
    recordKey:
      item?.recordKey ?? null,

    classification,

    currentAmmoCandidate,
    staticOnly,

    evidence: {
      direct,
      separatedNonDirect,
      nested,
      diagnostic,
      diagnosticUnexplainedByStatic,
      metadata,
      dynamicMetadata,
      corroboratingRecordTokens,
      explicitCurrentAmmo,
      all,
    },
  };
}

export function buildCensusV03(effects) {
  const universe =
    getScript139Universe(
      effects,
    );

  const items =
    universe.items
      .map(
        item =>
          classifyAmmoItemV03(item),
      )
      .sort(
        (a, b) =>
          classOrder(a.classification)
          - classOrder(b.classification)
          || String(a.recordKey)
            .localeCompare(
              String(b.recordKey),
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

  const noAmmoEvidence =
    items.filter(
      row =>
        row.classification
        === 'NO_AMMO_MECHANISM_EVIDENCE',
    );

  return {
    universe,

    byClassification:
      countBy(
        items,
        row =>
          row.classification,
      ),

    currentAmmoCandidateCount:
      currentAmmoCandidates.length,

    staticOnlyCount:
      staticOnly.length,

    noAmmoEvidenceCount:
      noAmmoEvidence.length,

    currentAmmoCandidates,
    staticOnly,
    noAmmoEvidence:
      noAmmoEvidence.map(
        row =>
          row.recordKey,
      ),

    items,

    classification:
      (
        universe.status
          === EXPECTED_EFFECT_STATUS
        && universe.itemCount === 156
        && universe.recordKeyCount === 156
        && universe.uniqueRecordKeyCount === 156
        && universe.missingRecordKeyCount === 0
        && universe.duplicateRecordKeys.length === 0
      )
        ? 'COMPLETE_SCRIPT139_156_ITEM_STANDARD_SHOP_AMMO_CENSUS_V03'
        : 'SCRIPT139_STANDARD_SHOP_AMMO_CENSUS_V03_INCOMPLETE',
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
  const counts =
    new Map();

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
    CURRENT_AMMO_FIELD_CANDIDATE: 0,
    NON_DIRECT_OR_DYNAMIC_AMMO_CANDIDATE: 1,
    AMMO_RESOURCE_EVIDENCE_UNRESOLVED: 2,
    STATIC_CAPACITY_AND_RELOAD_RATE_EFFECT: 3,
    STATIC_CLIP_OR_MAGAZINE_CAPACITY_EFFECT: 4,
    STATIC_RELOAD_RATE_EFFECT: 5,
    NO_AMMO_MECHANISM_EVIDENCE: 6,
  };

  return order[value] ?? 99;
}
