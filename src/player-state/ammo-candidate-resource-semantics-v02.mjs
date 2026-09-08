// Script204 V02 helpers.
//
// Successor to V01 semantic-discrimination failure.
//
// V01 correctly joined all 18 candidates, but incorrectly treated:
//   - recordKey / icon / CSS strings,
//   - propertyKey / providedPropertyType declarations,
//   - modifier token names,
// as "value-bearing ammo resources".
//
// V02 requires an actual supplied scalar value for value-bearing evidence:
//   1. finite numericValue;
//   2. parseable/nonempty `value` on an ammo/reload direct-stat record;
//   3. a raw scalar field whose KEY itself is ammo/reload semantic.
//
// Field names, paths, modifier names, metadata, and schema declarations remain
// evidence, but are explicitly non-value-bearing.
//
// Resource-build-bound only. No runtime causal attribution.

const AMMO_TERM =
  /(ammo|clip|magazine|reload)/i;

const CURRENT_AMMO_TERM =
  /(?:ammoreloadpercent|activereloadpercent|procammo|bonusclipperkill|ammorestore|ammorefill|ammorefund|ammoreplenish|restoreammo|refillammo|refundammo|replenishammo)/i;

const STATIC_CAPACITY_TERM =
  /(?:bonusclipsize|bonusclipsizepercent|ammoclipsize|ammoclipsizepercent|clipsize|magazinesize|maxammo)/i;

const STATIC_RELOAD_RATE_TERM =
  /(?:reloadspeed|reloadspeedmultipler|reloadspeedmultiplier|reloadmultiplier)/i;

const TRIGGER_TERM =
  /(proc|trigger|watcher|active|activate|kill|hit|cast|cooldown|duration|buff|charge|imbue)/i;

const NON_VALUE_PATH_TERM =
  /(genericRecordFieldNamesDiagnosticOnly|modifierBearingFieldNames|timingFieldNames|recordModifierTokens|nestedModifierClasses|selectedTopLevelMetadata|propertyKey|providedPropertyType|modifierValueTokens|zeroOrEmptyDirectProvidedStats)/i;

export function findScript139Item(
  effects,
  recordKey,
) {
  return (
    Array.isArray(effects?.items)
      ? effects.items
      : []
  ).find(
    item =>
      item?.recordKey === recordKey,
  ) ?? null;
}

export function collectDirectAmmoStatRecords(item) {
  const sources = [
    [
      'directProvidedStats',
      item?.directProvidedStats,
    ],
    [
      'meaningfulDirectProvidedStats',
      item?.meaningfulDirectProvidedStats,
    ],
    [
      'weaponStateRelevant.directProvidedStats',
      item?.weaponStateRelevant?.directProvidedStats,
    ],
    [
      'weaponStateRelevant.operation.directProvidedStats',
      item?.weaponStateRelevant?.operation?.directProvidedStats,
    ],
  ];

  const rows = [];

  for (const [source, records] of sources) {
    if (!Array.isArray(records)) continue;

    records.forEach((record, index) => {
      const semanticStrings = [
        record?.propertyKey,
        record?.providedPropertyType,
        ...(Array.isArray(record?.modifierValueTokens)
          ? record.modifierValueTokens
          : []),
      ].filter(
        value =>
          typeof value === 'string',
      );

      const semanticText =
        semanticStrings.join(' ');

      if (!AMMO_TERM.test(semanticText)) {
        return;
      }

      const supplied =
        extractSuppliedValue(record);

      rows.push({
        source,
        index,
        path:
          `$.${source}[${index}]`,
        propertyKey:
          record?.propertyKey ?? null,
        providedPropertyType:
          record?.providedPropertyType ?? null,
        modifierValueTokens:
          Array.isArray(record?.modifierValueTokens)
            ? record.modifierValueTokens
            : [],
        usageFlags:
          record?.usageFlags ?? null,
        displayUnits:
          record?.displayUnits ?? null,
        value:
          supplied.value,
        numericValue:
          supplied.numericValue,
        suppliedValuePresent:
          supplied.present,
        valueSource:
          supplied.source,
        semanticClass:
          classifySemanticText(
            semanticText,
          ),
      });
    });
  }

  return dedupe(
    rows,
    row =>
      [
        row.source,
        row.index,
        row.propertyKey,
        row.providedPropertyType,
        row.value,
        row.numericValue,
      ].join('|'),
  );
}

export function collectRawAmmoScalarFields(item) {
  const rows = [];
  const seen = new WeakSet();

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

    for (const [key, child] of Object.entries(node)) {
      const childPath =
        `${path}.${key}`;

      if (
        AMMO_TERM.test(key)
        && isScalar(child)
        && !NON_VALUE_PATH_TERM.test(childPath)
      ) {
        const parsed =
          parseScalarValue(child);

        rows.push({
          path:
            childPath,
          key,
          value:
            child,
          numericValue:
            parsed.numericValue,
          semanticClass:
            classifySemanticText(key),
          suppliedValuePresent:
            true,
        });
      }

      visit(
        child,
        childPath,
      );
    }
  }

  visit(item);

  return dedupe(
    rows,
    row =>
      `${row.path}|${String(row.value)}`,
  );
}

export function collectFieldNameEvidence(item) {
  const rows = [];

  const arrays = [
    [
      'weaponStateRelevant.genericRecordFieldNamesDiagnosticOnly',
      item?.weaponStateRelevant
        ?.genericRecordFieldNamesDiagnosticOnly,
    ],
    [
      'weaponStateRelevant.operation.genericRecordFieldNamesDiagnosticOnly',
      item?.weaponStateRelevant
        ?.operation
        ?.genericRecordFieldNamesDiagnosticOnly,
    ],
    [
      'modifierBearingFieldNames',
      item?.modifierBearingFieldNames,
    ],
    [
      'timingFieldNames',
      item?.timingFieldNames,
    ],
    [
      'nestedModifierClasses',
      item?.nestedModifierClasses,
    ],
  ];

  for (const [source, values] of arrays) {
    if (!Array.isArray(values)) continue;

    values.forEach((value, index) => {
      if (
        typeof value !== 'string'
        || !AMMO_TERM.test(value)
      ) {
        return;
      }

      rows.push({
        source,
        index,
        value,
        semanticClass:
          classifySemanticText(value),
        triggerHint:
          TRIGGER_TERM.test(value),
      });
    });
  }

  return rows;
}

export function collectTriggerHints(item) {
  const values = [];

  const candidates = [
    item?.recordKey,
    ...(Array.isArray(item?.nestedModifierClasses)
      ? item.nestedModifierClasses
      : []),
    ...(Array.isArray(
      item?.weaponStateRelevant
        ?.genericRecordFieldNamesDiagnosticOnly,
    )
      ? item.weaponStateRelevant
        .genericRecordFieldNamesDiagnosticOnly
      : []),
    item?.selectedTopLevelMetadata?.m_strCSSClass,
    item?.selectedTopLevelMetadata?.m_strShopIconLarge,
    item?.selectedTopLevelMetadata?.m_AbilityBehaviorsBits,
  ];

  for (const value of candidates) {
    if (
      typeof value !== 'string'
      || !TRIGGER_TERM.test(value)
    ) {
      continue;
    }

    values.push(value);
  }

  return [...new Set(values)].sort();
}

export function summarizeCandidateV02({
  candidate,
  item,
}) {
  const direct =
    collectDirectAmmoStatRecords(
      item,
    );

  const rawScalars =
    collectRawAmmoScalarFields(
      item,
    );

  const fieldNames =
    collectFieldNameEvidence(
      item,
    );

  const triggerHints =
    collectTriggerHints(
      item,
    );

  const directWithValue =
    direct.filter(
      row =>
        row.suppliedValuePresent,
    );

  const currentAmmoValues = [
    ...directWithValue.filter(
      row =>
        row.semanticClass
        === 'CURRENT_AMMO',
    ),
    ...rawScalars.filter(
      row =>
        row.semanticClass
        === 'CURRENT_AMMO',
    ),
  ];

  const staticCapacityValues = [
    ...directWithValue.filter(
      row =>
        row.semanticClass
        === 'STATIC_CAPACITY',
    ),
    ...rawScalars.filter(
      row =>
        row.semanticClass
        === 'STATIC_CAPACITY',
    ),
  ];

  const staticReloadValues = [
    ...directWithValue.filter(
      row =>
        row.semanticClass
        === 'STATIC_RELOAD_RATE',
    ),
    ...rawScalars.filter(
      row =>
        row.semanticClass
        === 'STATIC_RELOAD_RATE',
    ),
  ];

  const currentAmmoFieldNames =
    fieldNames.filter(
      row =>
        row.semanticClass
        === 'CURRENT_AMMO',
    );

  let evidenceDepth =
    'WEAK_NAME_OR_SCHEMA_HINT_ONLY';

  if (currentAmmoValues.length > 0) {
    evidenceDepth =
      'EXPLICIT_CURRENT_AMMO_VALUE_PRESENT';
  } else if (
    currentAmmoFieldNames.length > 0
    && triggerHints.length > 0
  ) {
    evidenceDepth =
      'CURRENT_AMMO_FIELD_WITH_TRIGGER_HINT_NO_VALUE';
  } else if (
    currentAmmoFieldNames.length > 0
  ) {
    evidenceDepth =
      'CURRENT_AMMO_FIELD_NAME_ONLY';
  } else if (
    staticCapacityValues.length > 0
    || staticReloadValues.length > 0
  ) {
    evidenceDepth =
      'STATIC_AMMO_VALUE_ONLY';
  } else if (
    direct.length > 0
  ) {
    evidenceDepth =
      'AMMO_STAT_DECLARATION_WITHOUT_VALUE';
  } else if (
    fieldNames.length > 0
  ) {
    evidenceDepth =
      'AMMO_FIELD_NAME_ONLY';
  }

  return {
    recordKey:
      candidate.recordKey,

    runtimeItemId:
      candidate.runtimeItemId,

    resourceClassification:
      candidate.resourceClassification,

    itemFound:
      Boolean(item),

    evidenceDepth,

    currentAmmoValueCount:
      currentAmmoValues.length,

    currentAmmoFieldNameCount:
      currentAmmoFieldNames.length,

    staticCapacityValueCount:
      staticCapacityValues.length,

    staticReloadValueCount:
      staticReloadValues.length,

    directAmmoDeclarationCount:
      direct.length,

    directAmmoValueCount:
      directWithValue.length,

    rawAmmoScalarCount:
      rawScalars.length,

    triggerHintCount:
      triggerHints.length,

    currentAmmoValues,
    currentAmmoFieldNames,
    staticCapacityValues,
    staticReloadValues,
    directAmmoStats:
      direct,
    rawAmmoScalars:
      rawScalars,
    fieldNameEvidence:
      fieldNames,
    triggerHints,
  };
}

export function buildSemanticAuditV02({
  candidates,
  effects,
}) {
  const rows =
    candidates.map(
      candidate =>
        summarizeCandidateV02({
          candidate,
          item:
            findScript139Item(
              effects,
              candidate.recordKey,
            ),
        }),
    );

  const missing =
    rows.filter(
      row =>
        !row.itemFound,
    );

  return {
    candidateCount:
      rows.length,

    missingItemCount:
      missing.length,

    missingRecordKeys:
      missing.map(
        row => row.recordKey,
      ),

    byDepth:
      countBy(
        rows,
        row => row.evidenceDepth,
      ),

    explicitCurrentAmmoValueCount:
      rows.filter(
        row =>
          row.currentAmmoValueCount > 0,
      ).length,

    currentAmmoFieldNoValueCount:
      rows.filter(
        row =>
          row.currentAmmoValueCount === 0
          && row.currentAmmoFieldNameCount > 0,
      ).length,

    rows:
      rows.sort(
        (a, b) =>
          depthOrder(a.evidenceDepth)
          - depthOrder(b.evidenceDepth)
          || a.recordKey.localeCompare(
            b.recordKey,
          ),
      ),

    classification:
      rows.length === 18
      && missing.length === 0
        ? 'COMPLETE_18_ITEM_STRICT_RESOURCE_VALUE_AUDIT_V02'
        : 'STRICT_RESOURCE_VALUE_AUDIT_V02_INCOMPLETE',
  };
}

function extractSuppliedValue(record) {
  if (
    Number.isFinite(
      Number(record?.numericValue),
    )
    && record?.numericValue !== null
    && record?.numericValue !== ''
  ) {
    return {
      present:
        true,
      source:
        'numericValue',
      value:
        record?.value ?? null,
      numericValue:
        Number(record.numericValue),
    };
  }

  if (
    record?.value !== undefined
    && record?.value !== null
    && String(record.value).trim() !== ''
  ) {
    const parsed =
      parseScalarValue(
        record.value,
      );

    return {
      present:
        true,
      source:
        'value',
      value:
        record.value,
      numericValue:
        parsed.numericValue,
    };
  }

  return {
    present:
      false,
    source:
      null,
    value:
      null,
    numericValue:
      null,
  };
}

function parseScalarValue(value) {
  if (typeof value === 'number') {
    return {
      numericValue:
        Number.isFinite(value)
          ? value
          : null,
    };
  }

  if (typeof value === 'string') {
    const match =
      value
        .trim()
        .match(
          /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)/,
        );

    return {
      numericValue:
        match
          ? Number(match[0])
          : null,
    };
  }

  return {
    numericValue:
      null,
  };
}

function classifySemanticText(value) {
  const text =
    normalize(value);

  if (
    CURRENT_AMMO_TERM.test(text)
  ) {
    return 'CURRENT_AMMO';
  }

  if (
    STATIC_CAPACITY_TERM.test(text)
  ) {
    return 'STATIC_CAPACITY';
  }

  if (
    STATIC_RELOAD_RATE_TERM.test(text)
  ) {
    return 'STATIC_RELOAD_RATE';
  }

  return 'AMMO_OTHER';
}

function normalize(value) {
  return String(value)
    .replace(
      /[^a-z0-9]+/gi,
      '',
    )
    .toLowerCase();
}

function isScalar(value) {
  return (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  );
}

function dedupe(rows, keyFn) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    const key =
      keyFn(row);

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
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
        depthOrder(a.key)
        - depthOrder(b.key)
        || a.key.localeCompare(b.key),
    );
}

function depthOrder(value) {
  const order = {
    EXPLICIT_CURRENT_AMMO_VALUE_PRESENT: 0,
    CURRENT_AMMO_FIELD_WITH_TRIGGER_HINT_NO_VALUE: 1,
    CURRENT_AMMO_FIELD_NAME_ONLY: 2,
    STATIC_AMMO_VALUE_ONLY: 3,
    AMMO_STAT_DECLARATION_WITHOUT_VALUE: 4,
    AMMO_FIELD_NAME_ONLY: 5,
    WEAK_NAME_OR_SCHEMA_HINT_ONLY: 6,
  };

  return order[value] ?? 99;
}
