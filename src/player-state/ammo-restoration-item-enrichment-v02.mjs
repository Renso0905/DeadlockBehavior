export const DEADLOCK_MURMUR_SEED = 0x31415926;

const AMMO_RE = /(ammo|reload|clip|bullet|magazine)/i;

export function murmurHash2(text, seed = DEADLOCK_MURMUR_SEED) {
  const bytes = Buffer.from(String(text), 'utf8');
  const m = 0x5bd1e995;
  const r = 24;

  let h = (seed ^ bytes.length) >>> 0;
  let i = 0;
  let remaining = bytes.length;

  while (remaining >= 4) {
    let k =
      (
        bytes[i]
        | (bytes[i + 1] << 8)
        | (bytes[i + 2] << 16)
        | (bytes[i + 3] << 24)
      ) >>> 0;

    k = Math.imul(k, m) >>> 0;
    k ^= k >>> r;
    k = Math.imul(k, m) >>> 0;

    h = Math.imul(h, m) >>> 0;
    h ^= k;

    i += 4;
    remaining -= 4;
  }

  if (remaining === 3) h ^= bytes[i + 2] << 16;
  if (remaining >= 2) h ^= bytes[i + 1] << 8;

  if (remaining >= 1) {
    h ^= bytes[i];
    h = Math.imul(h, m) >>> 0;
  }

  h ^= h >>> 13;
  h = Math.imul(h, m) >>> 0;
  h ^= h >>> 15;

  return h >>> 0;
}

export function collectRecordKeyObjects(root) {
  const rows = [];
  const seen = new WeakSet();

  function visit(node, path = '$') {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (
      !Array.isArray(node)
      && typeof node.recordKey === 'string'
    ) {
      rows.push({
        path,
        recordKey: node.recordKey,
        object: node,
      });
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

  visit(root);
  return rows;
}

export function buildCatalogHashIndex(catalog) {
  const byHash = new Map();
  const collisions = [];

  for (const row of collectRecordKeyObjects(catalog)) {
    const hash = murmurHash2(row.recordKey);

    if (byHash.has(hash)) {
      collisions.push({
        hash,
        recordKeys: [
          byHash.get(hash).recordKey,
          row.recordKey,
        ],
      });
      continue;
    }

    byHash.set(hash, {
      runtimeItemId: hash,
      recordKey: row.recordKey,
      path: row.path,
      object: row.object,
    });
  }

  return {
    byHash,
    collisions,
  };
}

export function buildEffectRecordIndex(effects) {
  const byRecordKey = new Map();

  for (const row of collectRecordKeyObjects(effects)) {
    if (!byRecordKey.has(row.recordKey)) {
      byRecordKey.set(
        row.recordKey,
        [],
      );
    }

    byRecordKey
      .get(row.recordKey)
      .push(row);
  }

  return byRecordKey;
}

export function resolveRuntimeItems({
  runtimeItemIds,
  catalog,
  effects,
}) {
  const catalogIndex =
    buildCatalogHashIndex(catalog);

  const effectIndex =
    buildEffectRecordIndex(effects);

  const resolved = [];
  const unresolved = [];

  for (const itemId of runtimeItemIds) {
    const catalogRow =
      catalogIndex.byHash.get(
        Number(itemId),
      );

    if (!catalogRow) {
      unresolved.push(Number(itemId));
      continue;
    }

    const effectRows =
      effectIndex.get(
        catalogRow.recordKey,
      ) ?? [];

    resolved.push({
      itemId: Number(itemId),
      recordKey:
        catalogRow.recordKey,
      catalogPath:
        catalogRow.path,
      catalogIdentity:
        identityFromObject(
          catalogRow.object,
        ),
      effectMatchCount:
        effectRows.length,
      ammoEffectEvidence:
        collectAmmoEvidence(
          effectRows.map(
            row => row.object,
          ),
        ),
    });
  }

  return {
    resolved,
    unresolved,
    catalogHashCollisions:
      catalogIndex.collisions,
  };
}

export function annotateEnrichmentRows({
  enrichmentRows,
  catalog,
  effects,
}) {
  const ids =
    [...new Set(
      enrichmentRows.map(
        row => Number(row.itemId),
      ),
    )];

  const resolution =
    resolveRuntimeItems({
      runtimeItemIds: ids,
      catalog,
      effects,
    });

  const byId =
    new Map(
      resolution.resolved.map(
        row => [row.itemId, row],
      ),
    );

  return {
    rows:
      enrichmentRows.map(
        row => ({
          ...row,
          itemResolution:
            byId.get(
              Number(row.itemId),
            ) ?? null,
        }),
      ),
    resolution,
  };
}

export function summarizeResolvedCandidates(rows) {
  const byItem = new Map();

  for (const row of rows) {
    const resolved =
      row.itemResolution;

    if (!resolved) continue;

    if (!byItem.has(row.itemId)) {
      byItem.set(row.itemId, {
        itemId: row.itemId,
        recordKey:
          resolved.recordKey,
        catalogIdentity:
          resolved.catalogIdentity,
        heroIds: [],
        restorationPresent: 0,
        restorationEvents: 0,
        attacksPresent: 0,
        ammoEffectEvidence:
          new Set(),
      });
    }

    const agg =
      byItem.get(row.itemId);

    agg.heroIds.push(
      row.heroId,
    );

    agg.restorationPresent +=
      row.restorationPresent;

    agg.restorationEvents +=
      row.restorationEvents;

    agg.attacksPresent +=
      row.attacksPresent;

    for (
      const token
      of resolved.ammoEffectEvidence
    ) {
      agg.ammoEffectEvidence
        .add(token);
    }
  }

  const crossHero =
    [...byItem.values()]
      .map(row => ({
        ...row,
        heroIds:
          [...new Set(row.heroIds)],
        heroSupport:
          new Set(row.heroIds).size,
        ammoEffectEvidence:
          [...row.ammoEffectEvidence],
      }))
      .sort(
        (a, b) =>
          b.heroSupport - a.heroSupport
          || b.restorationPresent
            - a.restorationPresent
          || b.ammoEffectEvidence.length
            - a.ammoEffectEvidence.length,
      );

  return {
    crossHero,
    classification:
      crossHero.some(
        row =>
          row.heroSupport >= 2
          && row.restorationPresent >= 3
          && row.ammoEffectEvidence.length > 0,
      )
        ? 'RESOLVED_CROSS_HERO_ITEM_WITH_AMMO_EFFECT_EVIDENCE_AVAILABLE_FOR_SPECIFIC_HYPOTHESIS'
        : 'RESOLVED_ITEM_JOIN_DOES_NOT_IDENTIFY_SINGLE_CROSS_HERO_AMMO_MECHANISM',
  };
}

function identityFromObject(object) {
  const keys = [
    'recordKey',
    'itemName',
    'displayName',
    'name',
    'itemSlot',
    'itemTier',
    'shopPrice',
  ];

  const identity = {};

  for (const key of keys) {
    if (object?.[key] !== undefined) {
      identity[key] = object[key];
    }
  }

  return identity;
}

function collectAmmoEvidence(objects) {
  const evidence = new Set();
  const seen = new WeakSet();

  function visit(node, key = '') {
    if (node === null || node === undefined) return;

    if (
      typeof node === 'string'
      || typeof node === 'number'
      || typeof node === 'boolean'
    ) {
      const value =
        String(node);

      if (
        AMMO_RE.test(key)
        || AMMO_RE.test(value)
      ) {
        evidence.add(
          `${key}=${value}`,
        );
      }

      return;
    }

    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) {
        visit(child, key);
      }
      return;
    }

    for (const [childKey, child] of Object.entries(node)) {
      visit(child, childKey);
    }
  }

  for (const object of objects) {
    visit(object);
  }

  return [...evidence]
    .sort()
    .slice(0, 100);
}
