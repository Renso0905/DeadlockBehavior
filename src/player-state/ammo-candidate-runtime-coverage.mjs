// Script203 helpers.
//
// Discovery/calibration only.
//
// Takes the complete Script202 V03 18-item current-ammo candidate universe and
// measures how much of that universe is actually exposed in test.dem.
//
// This answers a coverage question, not a causal-attribution question:
//
//   - OBSERVED_WITH_RESTORATION:
//       item is present in >=1 of the 8 coherent restoration contexts.
//   - OBSERVED_NEGATIVE_EXPOSURE_ONLY:
//       item is present during primary attacks in test, but never in one of
//       the 8 coherent restoration contexts.
//   - NOT_OBSERVED_IN_TEST:
//       no primary-attack exposure with this item in test.
//
// The latter two categories do NOT prove the item cannot restore ammo.
// Trigger conditions may simply never have occurred.

export const DEADLOCK_MURMUR_SEED = 0x31415926;

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

export function extractItemIds(value) {
  const ids = new Set();
  const seen = new WeakSet();

  function visit(node) {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (!Array.isArray(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (
          key === 'itemId'
          && Number.isFinite(Number(child))
        ) {
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
          : typeof node.id === 'string'
            && /^weapon-context-\d+$/.test(node.id)
              ? node.id
              : null;

      if (effectContextId) {
        contexts.set(effectContextId, {
          effectContextId,
          heroId:
            Number.isFinite(Number(node.heroId))
              ? Number(node.heroId)
              : null,
          itemIds: extractItemIds(node),
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

export function buildRestorationEvents(script199) {
  const events = [];

  for (const context of script199?.diagnostic?.contexts ?? []) {
    const ticks = context?.ticks ?? [];
    const heroes = context?.heroes ?? [];
    const net = context?.netGains ?? [];
    const gross = context?.grossRestorationCandidates ?? [];

    for (let i = 0; i < ticks.length; i++) {
      events.push({
        heroId:
          heroes.length === 1
            ? Number(heroes[0])
            : null,
        tick: Number(ticks[i]),
        effectContextId: context.effectContextId,
        logicalGain: Number(net[i]),
        grossRestorationIfOneShotConsumed: Number(gross[i]),
      });
    }
  }

  return events.sort((a, b) => a.tick - b.tick);
}

export function buildCandidateUniverse(script202v03) {
  return (
    script202v03
      ?.census
      ?.currentAmmoCandidates
    ?? []
  )
    .map(item => ({
      recordKey: item.recordKey,
      runtimeItemId: murmurHash2(item.recordKey),
      resourceClassification: item.classification,
      evidence: item.evidence,
    }))
    .sort(
      (a, b) =>
        a.recordKey.localeCompare(b.recordKey),
    );
}

export function summarizeRuntimeCoverage({
  candidates,
  contextIndex,
  runtimeRows,
  restorationEvents,
}) {
  const restorationByContext = new Map();

  for (const event of restorationEvents) {
    if (!restorationByContext.has(event.effectContextId)) {
      restorationByContext.set(event.effectContextId, []);
    }
    restorationByContext.get(event.effectContextId).push(event);
  }

  const rows =
    candidates.map(candidate => {
      let attackExposure = 0;
      const exposedHeroes = new Set();
      const exposedContexts = new Set();

      for (const runtimeRow of runtimeRows) {
        const changedFields =
          Array.isArray(runtimeRow?.changedFields)
            ? runtimeRow.changedFields
            : [];

        if (!changedFields.includes('m_nShotNumber')) continue;

        const context =
          contextIndex.get(runtimeRow?.effectContextId);

        if (
          !context?.itemIds?.includes(
            candidate.runtimeItemId,
          )
        ) {
          continue;
        }

        attackExposure++;
        exposedContexts.add(context.effectContextId);

        const heroId = Number(runtimeRow?.heroId);
        if (Number.isFinite(heroId)) {
          exposedHeroes.add(heroId);
        }
      }

      const restorationMatches = [];

      for (const event of restorationEvents) {
        const context =
          contextIndex.get(event.effectContextId);

        if (
          context?.itemIds?.includes(
            candidate.runtimeItemId,
          )
        ) {
          restorationMatches.push(event);
        }
      }

      let disposition;

      if (restorationMatches.length > 0) {
        disposition =
          'OBSERVED_WITH_RESTORATION';
      } else if (attackExposure > 0) {
        disposition =
          'OBSERVED_NEGATIVE_EXPOSURE_ONLY';
      } else {
        disposition =
          'NOT_OBSERVED_IN_TEST';
      }

      return {
        ...candidate,
        disposition,
        attackExposure,
        exposedHeroIds:
          [...exposedHeroes].sort((a, b) => a - b),
        exposedContextCount:
          exposedContexts.size,
        restorationEventCount:
          restorationMatches.length,
        restorationEvents:
          restorationMatches.map(event => ({
            heroId: event.heroId,
            tick: event.tick,
            effectContextId: event.effectContextId,
            logicalGain: event.logicalGain,
            grossRestorationIfOneShotConsumed:
              event.grossRestorationIfOneShotConsumed,
          })),
      };
    });

  const eventMatrix =
    restorationEvents.map(event => {
      const context =
        contextIndex.get(event.effectContextId);

      const presentCandidates =
        candidates
          .filter(candidate =>
            context?.itemIds?.includes(
              candidate.runtimeItemId,
            ),
          )
          .map(candidate => ({
            recordKey: candidate.recordKey,
            runtimeItemId: candidate.runtimeItemId,
            resourceClassification:
              candidate.resourceClassification,
          }))
          .sort(
            (a, b) =>
              a.recordKey.localeCompare(b.recordKey),
          );

      return {
        ...event,
        candidateCount:
          presentCandidates.length,
        presentCandidates,
      };
    });

  const observedWithRestoration =
    rows.filter(
      row =>
        row.disposition
        === 'OBSERVED_WITH_RESTORATION',
    );

  const observedNegativeOnly =
    rows.filter(
      row =>
        row.disposition
        === 'OBSERVED_NEGATIVE_EXPOSURE_ONLY',
    );

  const notObserved =
    rows.filter(
      row =>
        row.disposition
        === 'NOT_OBSERVED_IN_TEST',
    );

  return {
    candidateCount: rows.length,
    observedWithRestorationCount:
      observedWithRestoration.length,
    observedNegativeOnlyCount:
      observedNegativeOnly.length,
    notObservedCount:
      notObserved.length,
    observedCoverageRate:
      rows.length > 0
        ? (
          observedWithRestoration.length
          + observedNegativeOnly.length
        ) / rows.length
        : null,
    rows,
    eventMatrix,
    classification:
      rows.length === 18
        ? 'COMPLETE_18_ITEM_CANDIDATE_RUNTIME_COVERAGE_MATRIX_ON_TEST'
        : 'CANDIDATE_RUNTIME_COVERAGE_MATRIX_INCOMPLETE',
  };
}
