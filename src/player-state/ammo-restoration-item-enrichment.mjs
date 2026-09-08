const AMMO_RE = /(ammo|reload|clip|bullet|magazine)/i;

export function extractItemIds(value) {
  const ids = new Set();
  const seen = new WeakSet();

  function visit(node) {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (!Array.isArray(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (key === 'itemId' && Number.isFinite(Number(child))) {
          ids.add(Number(child));
        }
        visit(child);
      }
      return;
    }

    for (const child of node) visit(child);
  }

  visit(value);
  return [...ids].sort((a, b) => a - b);
}

export function buildContextIndex(substrate) {
  const contexts = new Map();
  const seen = new WeakSet();

  function visit(node) {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (!Array.isArray(node)) {
      const effectContextId =
        typeof node.effectContextId === 'string'
          ? node.effectContextId
          : typeof node.id === 'string' && /^weapon-context-\d+$/.test(node.id)
            ? node.id
            : null;

      if (effectContextId) {
        contexts.set(effectContextId, {
          effectContextId,
          heroId: Number.isFinite(Number(node.heroId)) ? Number(node.heroId) : null,
          itemIds: extractItemIds(node),
          raw: node,
        });
      }

      for (const child of Object.values(node)) visit(child);
      return;
    }

    for (const child of node) visit(child);
  }

  visit(substrate);
  return contexts;
}

export function summarizeAttackExposure(runtimeRows) {
  const byContext = new Map();

  for (const row of runtimeRows) {
    const changedFields = Array.isArray(row?.changedFields) ? row.changedFields : [];
    if (!changedFields.includes('m_nShotNumber')) continue;

    const heroId = Number(row?.heroId);
    const effectContextId = row?.effectContextId;

    if (!Number.isFinite(heroId) || typeof effectContextId !== 'string') continue;

    const key = `${heroId}|${effectContextId}`;
    byContext.set(key, (byContext.get(key) ?? 0) + 1);
  }

  return byContext;
}

export function buildRestorationEvents(script199) {
  const events = [];

  for (const context of script199?.diagnostic?.contexts ?? []) {
    const ticks = context?.ticks ?? [];
    const net = context?.netGains ?? [];
    const gross = context?.grossRestorationCandidates ?? [];
    const heroes = context?.heroes ?? [];

    for (let i = 0; i < ticks.length; i++) {
      events.push({
        heroId: heroes.length === 1 ? Number(heroes[0]) : null,
        tick: Number(ticks[i]),
        effectContextId: context.effectContextId,
        logicalGain: Number(net[i]),
        grossRestorationIfOneShotConsumed: Number(gross[i]),
      });
    }
  }

  return events;
}

export function computeItemEnrichment({
  restorationEvents,
  contextIndex,
  attackExposure,
}) {
  const heroes = [
    ...new Set(
      restorationEvents
        .map(row => row.heroId)
        .filter(Number.isFinite),
    ),
  ];

  const rows = [];

  for (const heroId of heroes) {
    const heroRestorations =
      restorationEvents.filter(row => row.heroId === heroId);

    const heroContexts =
      [...contextIndex.values()]
        .filter(context => context.heroId === heroId)
        .map(context => ({
          ...context,
          attackCount:
            attackExposure.get(`${heroId}|${context.effectContextId}`) ?? 0,
        }))
        .filter(context => context.attackCount > 0);

    const candidateItems = new Set();

    for (const event of heroRestorations) {
      const context = contextIndex.get(event.effectContextId);
      for (const itemId of context?.itemIds ?? []) {
        candidateItems.add(itemId);
      }
    }

    for (const itemId of candidateItems) {
      let restorationPresent = 0;
      let restorationAbsent = 0;
      let attacksPresent = 0;
      let attacksAbsent = 0;

      for (const event of heroRestorations) {
        const context = contextIndex.get(event.effectContextId);
        if (context?.itemIds?.includes(itemId)) restorationPresent++;
        else restorationAbsent++;
      }

      for (const context of heroContexts) {
        if (context.itemIds.includes(itemId)) attacksPresent += context.attackCount;
        else attacksAbsent += context.attackCount;
      }

      const ratePresent =
        attacksPresent > 0 ? restorationPresent / attacksPresent : null;

      const rateAbsent =
        attacksAbsent > 0 ? restorationAbsent / attacksAbsent : null;

      let riskRatio = null;
      if (Number.isFinite(ratePresent) && Number.isFinite(rateAbsent)) {
        if (rateAbsent > 0) riskRatio = ratePresent / rateAbsent;
        else if (ratePresent > 0) riskRatio = Infinity;
      }

      rows.push({
        heroId,
        itemId,
        restorationEvents: heroRestorations.length,
        restorationPresent,
        restorationAbsent,
        restorationPresenceRate:
          heroRestorations.length > 0
            ? restorationPresent / heroRestorations.length
            : null,
        attacksPresent,
        attacksAbsent,
        restorationRatePresent: ratePresent,
        restorationRateAbsent: rateAbsent,
        riskRatio,
      });
    }
  }

  return rows.sort(
    (a, b) =>
      b.restorationPresent - a.restorationPresent
      || sortFiniteDesc(a.riskRatio, b.riskRatio)
      || a.itemId - b.itemId,
  );
}

export function annotateCandidates({
  enrichmentRows,
  catalog,
  effects,
}) {
  return enrichmentRows.map(row => {
    const catalogMatches = findObjectsContainingScalar(catalog, row.itemId);
    const effectMatches = findObjectsContainingScalar(effects, row.itemId);

    return {
      ...row,
      catalogIdentity: bestIdentity(catalogMatches),
      ammoEffectEvidence: collectAmmoEvidence(effectMatches),
      effectMatchCount: effectMatches.length,
    };
  });
}

export function summarizeCandidates(rows) {
  const byItem = new Map();

  for (const row of rows) {
    if (!byItem.has(row.itemId)) {
      byItem.set(row.itemId, {
        itemId: row.itemId,
        heroIds: [],
        restorationPresent: 0,
        restorationEvents: 0,
        attacksPresent: 0,
        catalogIdentity: row.catalogIdentity,
        ammoEffectEvidence: new Set(),
      });
    }

    const aggregate = byItem.get(row.itemId);
    aggregate.heroIds.push(row.heroId);
    aggregate.restorationPresent += row.restorationPresent;
    aggregate.restorationEvents += row.restorationEvents;
    aggregate.attacksPresent += row.attacksPresent;

    for (const token of row.ammoEffectEvidence) {
      aggregate.ammoEffectEvidence.add(token);
    }
  }

  const crossHero =
    [...byItem.values()]
      .map(row => ({
        ...row,
        heroIds: [...new Set(row.heroIds)],
        heroSupport: new Set(row.heroIds).size,
        ammoEffectEvidence: [...row.ammoEffectEvidence],
      }))
      .sort(
        (a, b) =>
          b.heroSupport - a.heroSupport
          || b.restorationPresent - a.restorationPresent
          || b.ammoEffectEvidence.length - a.ammoEffectEvidence.length,
      );

  return {
    perHero: rows,
    crossHero,
    classification:
      crossHero.some(
        row =>
          row.heroSupport >= 2
          && row.restorationPresent >= 3
          && row.ammoEffectEvidence.length > 0,
      )
        ? 'CROSS_HERO_ITEM_WITH_AMMO_EFFECT_EVIDENCE_AVAILABLE_FOR_SPECIFIC_HYPOTHESIS'
        : 'NO_SINGLE_CROSS_HERO_ITEM_AMMO_MECHANISM_IDENTIFIED_YET',
  };
}

export function findObjectsContainingScalar(root, scalar) {
  const target = String(scalar);
  const results = [];
  const seen = new WeakSet();

  function visit(node, path = '$') {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (!Array.isArray(node)) {
      const scalarValues =
        Object.values(node)
          .filter(
            child =>
              child === null
              || ['string', 'number', 'boolean'].includes(typeof child),
          )
          .map(String);

      if (scalarValues.includes(target)) {
        results.push({ path, object: node });
      }

      for (const [key, child] of Object.entries(node)) {
        visit(child, `${path}.${key}`);
      }
      return;
    }

    node.forEach((child, i) => visit(child, `${path}[${i}]`));
  }

  visit(root);
  return results;
}

function bestIdentity(matches) {
  const keys = [
    'recordKey',
    'itemName',
    'displayName',
    'name',
    'className',
    'abilityName',
    'tier',
    'price',
    'slot',
    'shopSlot',
  ];

  for (const match of matches) {
    const identity = {};

    for (const key of keys) {
      if (match.object?.[key] !== undefined) {
        identity[key] = match.object[key];
      }
    }

    if (Object.keys(identity).length > 0) {
      return identity;
    }
  }

  return null;
}

function collectAmmoEvidence(matches) {
  const evidence = new Set();
  const seen = new WeakSet();

  function visit(node, key = '') {
    if (node === null || node === undefined) return;

    if (
      typeof node === 'string'
      || typeof node === 'number'
      || typeof node === 'boolean'
    ) {
      const value = String(node);

      if (AMMO_RE.test(key) || AMMO_RE.test(value)) {
        evidence.add(`${key}=${value}`);
      }
      return;
    }

    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) visit(child, key);
      return;
    }

    for (const [childKey, child] of Object.entries(node)) {
      visit(child, childKey);
    }
  }

  for (const match of matches) {
    visit(match.object);
  }

  return [...evidence].sort().slice(0, 100);
}

function sortFiniteDesc(a, b) {
  const aa = a === Infinity ? Number.MAX_SAFE_INTEGER : Number.isFinite(a) ? a : -Infinity;
  const bb = b === Infinity ? Number.MAX_SAFE_INTEGER : Number.isFinite(b) ? b : -Infinity;
  return bb - aa;
}
