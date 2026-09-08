// Script202 helpers.
//
// Exhaustive, replay-independent census of ammo-related resource evidence
// across the complete validated 156-item standard shop.
//
// Scientific purpose:
//   define the resource-level candidate universe BEFORE attributing runtime
//   ammo-restoration events to the subset of items observed in replays.
//
// Important:
//   - this is build-bound resource evidence;
//   - generic field-name evidence remains diagnostic-only;
//   - capacity/reload-speed effects are not automatically current-ammo restores;
//   - bullet-speed / bullet-resist / bullet-lifesteal are deliberately excluded
//     from ammo-mechanism evidence.

const STRICT_AMMO_TERM =
  /(ammo|clip|magazine|reload)/i;

const CURRENT_AMMO_RESTORE_TERM =
  /(?:ammo.*(?:reload|restore|refill|refund|replenish)|(?:reload|restore|refill|refund|replenish).*ammo|clip.*(?:restore|refill|refund)|magazine.*(?:restore|refill|refund))/i;

const CAPACITY_TERM =
  /(?:ammo[_\s-]*clip[_\s-]*size|bonus[_\s-]*clip[_\s-]*size|clipsize|clip[_\s-]*size|magazine[_\s-]*size|max[_\s-]*ammo)/i;

const RELOAD_RATE_TERM =
  /(?:reload[_\s-]*speed|reloadspeed|reload[_\s-]*multiplier|reloadspeedmultip)/i;

const BULLET_ONLY_TERM =
  /(?:bullet[_\s-]*speed|bullet[_\s-]*resist|bullet[_\s-]*armor|bullet[_\s-]*lifesteal|bullet[_\s-]*damage|bulletdamage)/i;

export function collectCatalogRecordKeys(catalog) {
  return collectRecordKeys(
    catalog,
    object =>
      typeof object.recordKey === 'string',
  );
}

export function collectEffectItems(effects) {
  const found = [];
  const seen = new WeakSet();
  const byKey = new Map();
  const duplicates = [];

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
        || Array.isArray(node.recordModifierTokens)
      )
    ) {
      const row = {
        recordKey: node.recordKey,
        path,
        object: node,
      };

      if (byKey.has(node.recordKey)) {
        duplicates.push({
          recordKey: node.recordKey,
          firstPath: byKey.get(node.recordKey).path,
          duplicatePath: path,
        });
      } else {
        byKey.set(node.recordKey, row);
        found.push(row);
      }
    }

    if (Array.isArray(node)) {
      node.forEach(
        (child, i) =>
          visit(child, `${path}[${i}]`),
      );
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      visit(child, `${path}.${key}`);
    }
  }

  visit(effects);

  return {
    rows: found,
    duplicates,
    byKey,
  };
}

export function classifyAmmoEvidence(item) {
  const evidence = [];

  collectStructuredEvidence(
    item?.meaningfulDirectProvidedStats,
    'meaningfulDirectProvidedStats',
    'A_MEANINGFUL_DIRECT',
    evidence,
  );

  collectStructuredEvidence(
    item?.directProvidedStats,
    'directProvidedStats',
    'RAW_DIRECT',
    evidence,
    {
      requireNonZero:
        true,
    },
  );

  collectStringArrayEvidence(
    item?.interpretation?.nonDirectModifierTokens,
    'interpretation.nonDirectModifierTokens',
    'B_NON_DIRECT_MODIFIER',
    evidence,
  );

  collectStringArrayEvidence(
    item?.recordModifierTokens,
    'recordModifierTokens',
    'B_RECORD_MODIFIER_TOKEN',
    evidence,
  );

  collectStringArrayEvidence(
    item?.nestedModifierClasses,
    'nestedModifierClasses',
    'B_NESTED_MODIFIER',
    evidence,
  );

  collectStringArrayEvidence(
    item?.weaponStateRelevant
      ?.genericRecordFieldNamesDiagnosticOnly,
    'weaponStateRelevant.genericRecordFieldNamesDiagnosticOnly',
    'C_DIAGNOSTIC_FIELD_NAME',
    evidence,
  );

  collectStringArrayEvidence(
    item?.weaponStateRelevant
      ?.operation
      ?.genericRecordFieldNamesDiagnosticOnly,
    'weaponStateRelevant.operation.genericRecordFieldNamesDiagnosticOnly',
    'C_DIAGNOSTIC_FIELD_NAME',
    evidence,
  );

  collectMetadataEvidence(
    item,
    evidence,
  );

  const deduped =
    dedupeEvidence(evidence);

  const meaningfulDirect =
    deduped.filter(
      row =>
        row.tier === 'A_MEANINGFUL_DIRECT'
        || row.tier === 'RAW_DIRECT',
    );

  const nonDirect =
    deduped.filter(
      row =>
        row.tier.startsWith('B_'),
    );

  const diagnostic =
    deduped.filter(
      row =>
        row.tier === 'C_DIAGNOSTIC_FIELD_NAME',
    );

  const nameOnly =
    deduped.filter(
      row =>
        row.tier === 'D_NAME_OR_METADATA_ONLY',
    );

  const currentAmmoRestore =
    deduped.filter(
      row =>
        row.currentAmmoRestoreCandidate,
    );

  const capacity =
    deduped.filter(
      row =>
        row.capacityEvidence,
    );

  const reloadRate =
    deduped.filter(
      row =>
        row.reloadRateEvidence,
    );

  let classification =
    'NO_AMMO_MECHANISM_EVIDENCE';

  if (currentAmmoRestore.length > 0) {
    classification =
      'CURRENT_AMMO_RESTORATION_OR_RELOAD_PERCENT_CANDIDATE';
  } else if (
    nonDirect.some(
      row =>
        STRICT_AMMO_TERM.test(row.value),
    )
  ) {
    classification =
      'NON_DIRECT_AMMO_OR_RELOAD_MECHANISM_CANDIDATE';
  } else if (
    capacity.length > 0
    && reloadRate.length > 0
  ) {
    classification =
      'CAPACITY_AND_RELOAD_RATE_EFFECT';
  } else if (capacity.length > 0) {
    classification =
      'CLIP_OR_MAGAZINE_CAPACITY_EFFECT_ONLY';
  } else if (reloadRate.length > 0) {
    classification =
      'RELOAD_RATE_EFFECT_ONLY';
  } else if (
    diagnostic.length > 0
    || nameOnly.length > 0
  ) {
    classification =
      'AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED';
  }

  return {
    recordKey:
      item?.recordKey ?? null,

    classification,

    evidence: {
      meaningfulDirect,
      nonDirect,
      diagnostic,
      nameOnly,
      currentAmmoRestore,
      capacity,
      reloadRate,
      all:
        deduped,
    },

    evidenceStrength:
      meaningfulDirect.length > 0
        ? 'MEANINGFUL_DIRECT_RESOURCE_EFFECT'
        : nonDirect.length > 0
          ? 'NON_DIRECT_OR_MODIFIER_RESOURCE_EVIDENCE'
          : diagnostic.length > 0
            ? 'DIAGNOSTIC_FIELD_NAME_ONLY'
            : nameOnly.length > 0
              ? 'NAME_OR_METADATA_ONLY'
              : 'NONE',
  };
}

export function buildAmmoMechanismCensus({
  catalog,
  effects,
}) {
  const catalogRows =
    collectCatalogRecordKeys(catalog);

  const effectItems =
    collectEffectItems(effects);

  const catalogKeys =
    new Set(
      catalogRows.map(
        row => row.recordKey,
      ),
    );

  const effectKeys =
    new Set(
      effectItems.rows.map(
        row => row.recordKey,
      ),
    );

  const missingEffects =
    [...catalogKeys]
      .filter(
        key =>
          !effectKeys.has(key),
      )
      .sort();

  const extraEffects =
    [...effectKeys]
      .filter(
        key =>
          !catalogKeys.has(key),
      )
      .sort();

  const items =
    effectItems.rows
      .filter(
        row =>
          catalogKeys.has(
            row.recordKey,
          ),
      )
      .map(row => ({
        ...classifyAmmoEvidence(
          row.object,
        ),
        path:
          row.path,
      }))
      .sort(
        (a, b) =>
          classificationOrder(
            a.classification,
          )
          - classificationOrder(
            b.classification,
          )
          || a.recordKey.localeCompare(
            b.recordKey,
          ),
      );

  const byClassification =
    countBy(
      items,
      row =>
        row.classification,
    );

  const restorationCandidates =
    items.filter(
      row =>
        [
          'CURRENT_AMMO_RESTORATION_OR_RELOAD_PERCENT_CANDIDATE',
          'NON_DIRECT_AMMO_OR_RELOAD_MECHANISM_CANDIDATE',
          'AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED',
        ].includes(
          row.classification,
        ),
    );

  const capacityOrReloadButNotRestore =
    items.filter(
      row =>
        [
          'CAPACITY_AND_RELOAD_RATE_EFFECT',
          'CLIP_OR_MAGAZINE_CAPACITY_EFFECT_ONLY',
          'RELOAD_RATE_EFFECT_ONLY',
        ].includes(
          row.classification,
        ),
    );

  const none =
    items.filter(
      row =>
        row.classification
        === 'NO_AMMO_MECHANISM_EVIDENCE',
    );

  return {
    catalogRows:
      catalogRows.length,

    effectItems:
      effectItems.rows.length,

    joinedItems:
      items.length,

    duplicateEffectRecordKeys:
      effectItems.duplicates,

    missingEffects,
    extraEffects,

    byClassification,

    restorationCandidateCount:
      restorationCandidates.length,

    capacityOrReloadButNotRestoreCount:
      capacityOrReloadButNotRestore.length,

    noAmmoEvidenceCount:
      none.length,

    restorationCandidates,

    capacityOrReloadButNotRestore,

    noAmmoEvidence:
      none.map(
        row => row.recordKey,
      ),

    items,

    classification:
      (
        catalogRows.length === 156
        && items.length === 156
        && missingEffects.length === 0
        && extraEffects.length === 0
      )
        ? 'COMPLETE_156_ITEM_STANDARD_SHOP_AMMO_MECHANISM_CENSUS'
        : 'AMMO_MECHANISM_CENSUS_INCOMPLETE',
  };
}

function collectRecordKeys(
  root,
  predicate,
) {
  const rows = [];
  const seen = new WeakSet();
  const keys = new Set();

  function visit(
    node,
    path = '$',
  ) {
    if (
      node === null
      || typeof node !== 'object'
    ) {
      return;
    }

    if (seen.has(node)) return;
    seen.add(node);

    if (
      !Array.isArray(node)
      && predicate(node)
    ) {
      if (!keys.has(node.recordKey)) {
        keys.add(node.recordKey);
        rows.push({
          recordKey:
            node.recordKey,
          path,
          object:
            node,
        });
      }
    }

    if (Array.isArray(node)) {
      node.forEach(
        (child, i) =>
          visit(
            child,
            `${path}[${i}]`,
          ),
      );
      return;
    }

    for (
      const [key, child]
      of Object.entries(node)
    ) {
      visit(
        child,
        `${path}.${key}`,
      );
    }
  }

  visit(root);

  return rows;
}

function collectStructuredEvidence(
  rows,
  source,
  tier,
  evidence,
  {
    requireNonZero = false,
  } = {},
) {
  if (!Array.isArray(rows)) return;

  for (const row of rows) {
    const candidateStrings =
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

    const scalarValues =
      collectScalarValues(row);

    const hasStrict =
      candidateStrings.some(
        string =>
          isStrictAmmoString(string),
      );

    if (!hasStrict) continue;

    if (
      requireNonZero
      && scalarValues.length > 0
      && scalarValues.every(
        value =>
          typeof value === 'number'
          && value === 0,
      )
    ) {
      continue;
    }

    for (const string of candidateStrings) {
      if (!isStrictAmmoString(string)) continue;

      evidence.push(
        evidenceRow({
          tier,
          source,
          value:
            string,
          payload:
            row,
        }),
      );
    }
  }
}

function collectStringArrayEvidence(
  value,
  source,
  tier,
  evidence,
) {
  const values =
    Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];

  for (const string of values) {
    if (
      typeof string !== 'string'
      || !isStrictAmmoString(string)
    ) {
      continue;
    }

    evidence.push(
      evidenceRow({
        tier,
        source,
        value:
          string,
        payload:
          null,
      }),
    );
  }
}

function collectMetadataEvidence(
  item,
  evidence,
) {
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

  for (
    const [source, value]
    of candidates
  ) {
    if (
      typeof value !== 'string'
      || !isStrictAmmoString(value)
    ) {
      continue;
    }

    evidence.push(
      evidenceRow({
        tier:
          'D_NAME_OR_METADATA_ONLY',
        source,
        value,
        payload:
          null,
      }),
    );
  }
}

function evidenceRow({
  tier,
  source,
  value,
  payload,
}) {
  return {
    tier,
    source,
    value,
    currentAmmoRestoreCandidate:
      CURRENT_AMMO_RESTORE_TERM
        .test(value),
    capacityEvidence:
      CAPACITY_TERM
        .test(value),
    reloadRateEvidence:
      RELOAD_RATE_TERM
        .test(value),
    payload,
  };
}

function isStrictAmmoString(
  value,
) {
  if (
    typeof value !== 'string'
    || !STRICT_AMMO_TERM.test(value)
  ) {
    return false;
  }

  if (
    BULLET_ONLY_TERM.test(value)
    && !STRICT_AMMO_TERM.test(
      value.replace(
        BULLET_ONLY_TERM,
        '',
      ),
    )
  ) {
    return false;
  }

  return true;
}

function collectScalarValues(
  root,
) {
  const values = [];
  const seen = new WeakSet();

  function visit(node) {
    if (
      node === null
      || node === undefined
    ) {
      return;
    }

    if (
      typeof node === 'number'
      || typeof node === 'string'
      || typeof node === 'boolean'
    ) {
      values.push(node);
      return;
    }

    if (
      typeof node !== 'object'
    ) {
      return;
    }

    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child);
      }
      return;
    }

    for (
      const child
      of Object.values(node)
    ) {
      visit(child);
    }
  }

  visit(root);

  return values;
}

function dedupeEvidence(
  evidence,
) {
  const seen = new Set();
  const rows = [];

  for (const row of evidence) {
    const key =
      `${row.tier}|${row.source}|${row.value}`;

    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  return rows;
}

function countBy(
  rows,
  keyFn,
) {
  const map = new Map();

  for (const row of rows) {
    const key =
      keyFn(row);

    map.set(
      key,
      (map.get(key) ?? 0) + 1,
    );
  }

  return [...map.entries()]
    .map(
      ([key, count]) => ({
        key,
        count,
      }),
    )
    .sort(
      (a, b) =>
        classificationOrder(a.key)
        - classificationOrder(b.key)
        || a.key.localeCompare(b.key),
    );
}

function classificationOrder(
  value,
) {
  const order = {
    CURRENT_AMMO_RESTORATION_OR_RELOAD_PERCENT_CANDIDATE: 0,
    NON_DIRECT_AMMO_OR_RELOAD_MECHANISM_CANDIDATE: 1,
    AMMO_NAMED_RESOURCE_EVIDENCE_UNRESOLVED: 2,
    CAPACITY_AND_RELOAD_RATE_EFFECT: 3,
    CLIP_OR_MAGAZINE_CAPACITY_EFFECT_ONLY: 4,
    RELOAD_RATE_EFFECT_ONLY: 5,
    NO_AMMO_MECHANISM_EVIDENCE: 6,
  };

  return order[value] ?? 99;
}
