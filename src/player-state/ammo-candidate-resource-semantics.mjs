// Script204 helpers.
//
// Resource-build-bound depth audit of the complete Script202 V03
// current-ammo candidate universe.
//
// Purpose:
//   distinguish actual value-bearing ammo/reload/trigger evidence from
//   diagnostic field-name-only evidence before targeted replay collection.
//
// No runtime causal attribution.

const PRIMARY_TERM =
  /(ammo|clip|magazine|reload)/i;

const CONTEXT_TERM =
  /(proc|trigger|watcher|modifier|ability|cast|activate|active|cooldown|duration|kill|hit|damage|buff|imbue|charge)/i;

export function findScript139Item(effects, recordKey) {
  return (
    Array.isArray(effects?.items)
      ? effects.items
      : []
  ).find(
    item =>
      item?.recordKey === recordKey,
  ) ?? null;
}

export function collectSemanticScalars(item) {
  const rows = [];
  const seen = new WeakSet();

  function visit(node, path = '$', parentKey = '') {
    if (
      node === null
      || typeof node === 'string'
      || typeof node === 'number'
      || typeof node === 'boolean'
    ) {
      const value =
        node === null
          ? null
          : node;

      const searchable =
        `${path} ${String(value)}`;

      if (
        PRIMARY_TERM.test(searchable)
        || (
          CONTEXT_TERM.test(searchable)
          && relevantAncestor(path)
        )
      ) {
        rows.push({
          path,
          parentKey,
          value,
          valueType:
            node === null
              ? 'null'
              : typeof node,
          valueBearing:
            node !== null
            && !isDiagnosticFieldNamePath(path),
          diagnosticFieldNameOnly:
            isDiagnosticFieldNamePath(path),
        });
      }

      return;
    }

    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(
        (child, i) =>
          visit(
            child,
            `${path}[${i}]`,
            parentKey,
          ),
      );
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      visit(
        child,
        `${path}.${key}`,
        key,
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

export function summarizeCandidateSemantics({
  candidate,
  item,
}) {
  const scalars =
    collectSemanticScalars(item);

  const primaryRows =
    scalars.filter(
      row =>
        PRIMARY_TERM.test(
          `${row.path} ${String(row.value)}`,
        ),
    );

  const valueBearingPrimary =
    primaryRows.filter(
      row =>
        row.valueBearing,
    );

  const diagnosticOnlyPrimary =
    primaryRows.filter(
      row =>
        row.diagnosticFieldNameOnly,
    );

  const triggerContext =
    scalars.filter(
      row =>
        CONTEXT_TERM.test(
          `${row.path} ${String(row.value)}`,
        ),
    );

  const numericAmmoValues =
    valueBearingPrimary.filter(
      row =>
        typeof row.value === 'number',
    );

  let evidenceDepth =
    'FIELD_NAME_OR_METADATA_ONLY';

  if (numericAmmoValues.length > 0) {
    evidenceDepth =
      'NUMERIC_AMMO_VALUE_PRESENT';
  } else if (
    valueBearingPrimary.length > 0
  ) {
    evidenceDepth =
      'VALUE_BEARING_AMMO_RESOURCE_PRESENT';
  } else if (
    triggerContext.length > 0
  ) {
    evidenceDepth =
      'TRIGGER_CONTEXT_WITHOUT_AMMO_VALUE';
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

    counts: {
      semanticScalars:
        scalars.length,
      primaryAmmoRows:
        primaryRows.length,
      valueBearingPrimary:
        valueBearingPrimary.length,
      diagnosticOnlyPrimary:
        diagnosticOnlyPrimary.length,
      numericAmmoValues:
        numericAmmoValues.length,
      triggerContext:
        triggerContext.length,
    },

    primaryAmmoRows: primaryRows,
    triggerContext,
  };
}

export function buildSemanticAudit({
  candidates,
  effects,
}) {
  const rows =
    candidates.map(
      candidate => {
        const item =
          findScript139Item(
            effects,
            candidate.recordKey,
          );

        return summarizeCandidateSemantics({
          candidate,
          item,
        });
      },
    );

  const missing =
    rows.filter(
      row =>
        !row.itemFound,
    );

  const byDepth =
    countBy(
      rows,
      row => row.evidenceDepth,
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

    byDepth,

    rows:
      rows.sort(
        (a, b) =>
          depthOrder(a.evidenceDepth)
          - depthOrder(b.evidenceDepth)
          || a.recordKey.localeCompare(b.recordKey),
      ),

    classification:
      rows.length === 18
      && missing.length === 0
        ? 'COMPLETE_18_ITEM_RESOURCE_SEMANTIC_DEPTH_AUDIT'
        : 'AMMO_CANDIDATE_RESOURCE_SEMANTIC_AUDIT_INCOMPLETE',
  };
}

function relevantAncestor(path) {
  return PRIMARY_TERM.test(path)
    || /(weaponStateRelevant|nestedModifier|interpretation|selectedTopLevelMetadata|directProvidedStats|meaningfulDirectProvidedStats)/i.test(
      path,
    );
}

function isDiagnosticFieldNamePath(path) {
  return /genericRecordFieldNamesDiagnosticOnly/i.test(
    path,
  );
}

function dedupe(rows, keyFn) {
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const key =
      keyFn(row);

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

function countBy(rows, keyFn) {
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
        depthOrder(a.key)
        - depthOrder(b.key)
        || a.key.localeCompare(b.key),
    );
}

function depthOrder(value) {
  const order = {
    NUMERIC_AMMO_VALUE_PRESENT: 0,
    VALUE_BEARING_AMMO_RESOURCE_PRESENT: 1,
    TRIGGER_CONTEXT_WITHOUT_AMMO_VALUE: 2,
    FIELD_NAME_OR_METADATA_ONLY: 3,
  };

  return order[value] ?? 99;
}
