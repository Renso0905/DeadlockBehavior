// Script201 helpers.
//
// Discovery/calibration only.
//
// Freezes the two-item candidate discovered after Script200 V02:
//
//   upgrade_quick_silver
//   upgrade_ethereal_bullets
//
// The central question is whether these two item states partition the eight
// Script198 V03 coherent ammo-restoration events and how restoration frequency
// compares across same-hero attack exposure states.
//
// This does NOT establish causality or validate either item mechanic.

export const QUICK_SILVER_ID = 84321454;
export const ETHEREAL_BULLETS_ID = 3919289022;

export const QUICK_SILVER_KEY = 'upgrade_quick_silver';
export const ETHEREAL_BULLETS_KEY = 'upgrade_ethereal_bullets';

const MECHANISM_RE =
  /(ammo|reload|clip|magazine|cooldown|trigger|proc|watcher|modifier|ability|imbue|duration|frequency)/i;

export function extractItemIds(node) {
  const ids = new Set();
  const seen = new WeakSet();

  function visit(value) {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
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

    for (const child of value) visit(child);
  }

  visit(node);
  return [...ids].sort((a, b) => a - b);
}

export function buildContextItemIndex(substrate) {
  const result = new Map();
  const seen = new WeakSet();

  function visit(value) {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) {
      const effectContextId =
        typeof value.effectContextId === 'string'
          ? value.effectContextId
          : typeof value.id === 'string'
            && /^weapon-context-\d+$/.test(value.id)
              ? value.id
              : null;

      if (effectContextId) {
        result.set(effectContextId, {
          effectContextId,
          heroId:
            Number.isFinite(Number(value.heroId))
              ? Number(value.heroId)
              : null,
          itemIds: extractItemIds(value),
        });
      }

      for (const child of Object.values(value)) visit(child);
      return;
    }

    for (const child of value) visit(child);
  }

  visit(substrate);
  return result;
}

export function buildRestorationEventsFromScript199(script199) {
  const rows = [];

  for (const context of script199?.diagnostic?.contexts ?? []) {
    const ticks = context?.ticks ?? [];
    const heroes = context?.heroes ?? [];
    const net = context?.netGains ?? [];
    const gross = context?.grossRestorationCandidates ?? [];

    for (let i = 0; i < ticks.length; i++) {
      rows.push({
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

  return rows.sort((a, b) => a.tick - b.tick);
}

export function classifyPairState(itemIds) {
  const quick =
    itemIds.includes(QUICK_SILVER_ID);

  const ethereal =
    itemIds.includes(ETHEREAL_BULLETS_ID);

  if (quick && ethereal) return 'BOTH';
  if (quick) return 'QUICK_SILVER_ONLY';
  if (ethereal) return 'ETHEREAL_BULLETS_ONLY';
  return 'NEITHER';
}

export function buildRestorationPairMatrix({
  restorationEvents,
  contextIndex,
  residualRows = [],
}) {
  const residualByKey =
    new Map(
      residualRows.map(
        row => [
          `${Number(row.heroId)}|${Number(row.tick)}`,
          row,
        ],
      ),
    );

  const rows =
    restorationEvents.map(event => {
      const context =
        contextIndex.get(event.effectContextId);

      const pairState =
        classifyPairState(
          context?.itemIds ?? [],
        );

      const residual =
        residualByKey.get(
          `${Number(event.heroId)}|${Number(event.tick)}`,
        ) ?? null;

      return {
        ...event,
        pairState,
        quickSilverPresent:
          pairState === 'QUICK_SILVER_ONLY'
          || pairState === 'BOTH',
        etherealBulletsPresent:
          pairState === 'ETHEREAL_BULLETS_ONLY'
          || pairState === 'BOTH',
        contextResolved:
          Boolean(context),
        previousCapacity:
          residual?.previousCapacity
          ?? residual?.capacity
          ?? null,
        currentCapacity:
          residual?.currentCapacity
          ?? residual?.capacity
          ?? null,
      };
    });

  return {
    rows,
    quickSilver:
      rows.filter(row => row.quickSilverPresent).length,
    etherealBullets:
      rows.filter(row => row.etherealBulletsPresent).length,
    both:
      rows.filter(row => row.pairState === 'BOTH').length,
    neither:
      rows.filter(row => row.pairState === 'NEITHER').length,
    xor:
      rows.filter(
        row =>
          row.pairState === 'QUICK_SILVER_ONLY'
          || row.pairState === 'ETHEREAL_BULLETS_ONLY',
      ).length,
  };
}

export function summarizePairAttackExposure({
  runtimeRows,
  contextIndex,
  restorationMatrixRows,
}) {
  const restorationKeys =
    new Set(
      restorationMatrixRows.map(
        row =>
          `${Number(row.heroId)}|${Number(row.tick)}`,
      ),
    );

  const byHeroState = new Map();

  for (const row of runtimeRows) {
    const changedFields =
      Array.isArray(row?.changedFields)
        ? row.changedFields
        : [];

    if (!changedFields.includes('m_nShotNumber')) continue;

    const heroId = Number(row?.heroId);
    const tick =
      Number(
        row?.tick
        ?? row?.demoTick
        ?? row?.gameTick,
      );

    const effectContextId =
      row?.effectContextId;

    if (
      !Number.isFinite(heroId)
      || !Number.isFinite(tick)
      || typeof effectContextId !== 'string'
    ) {
      continue;
    }

    const context =
      contextIndex.get(effectContextId);

    if (!context) continue;

    const pairState =
      classifyPairState(context.itemIds);

    const key =
      `${heroId}|${pairState}`;

    if (!byHeroState.has(key)) {
      byHeroState.set(key, {
        heroId,
        pairState,
        attacks: 0,
        restorations: 0,
      });
    }

    const summary =
      byHeroState.get(key);

    summary.attacks++;

    if (
      restorationKeys.has(
        `${heroId}|${tick}`,
      )
    ) {
      summary.restorations++;
    }
  }

  const rows =
    [...byHeroState.values()]
      .map(row => ({
        ...row,
        restorationRate:
          row.attacks > 0
            ? row.restorations / row.attacks
            : null,
      }))
      .sort(
        (a, b) =>
          a.heroId - b.heroId
          || pairOrder(a.pairState) - pairOrder(b.pairState),
      );

  return rows;
}

export function collectMechanismEvidenceForRecordKey(
  effects,
  recordKey,
) {
  const matches = [];
  const seen = new WeakSet();

  function visit(value, path = '$') {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (
      !Array.isArray(value)
      && value.recordKey === recordKey
    ) {
      matches.push({
        path,
        object: value,
      });
    }

    if (Array.isArray(value)) {
      value.forEach(
        (child, i) =>
          visit(child, `${path}[${i}]`),
      );
    } else {
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${path}.${key}`);
      }
    }
  }

  visit(effects);

  const evidence = [];

  for (const match of matches) {
    const scalars = [];

    collectScalars(
      match.object,
      match.path,
      scalars,
    );

    evidence.push({
      path: match.path,
      recordKey,
      relevantScalars:
        scalars.filter(
          row =>
            MECHANISM_RE.test(row.path)
            || MECHANISM_RE.test(String(row.value)),
        ),
    });
  }

  return evidence;
}

export function summarizeDualItemHypothesis({
  matrix,
  exposureRows,
  quickEvidence,
  etherealEvidence,
}) {
  const quickRestorations =
    matrix.rows.filter(
      row =>
        row.pairState === 'QUICK_SILVER_ONLY',
    );

  const etherealRestorations =
    matrix.rows.filter(
      row =>
        row.pairState === 'ETHEREAL_BULLETS_ONLY',
    );

  const quickHeroes =
    [...new Set(
      quickRestorations.map(row => row.heroId),
    )];

  const etherealHeroes =
    [...new Set(
      etherealRestorations.map(row => row.heroId),
    )];

  const exactPartition =
    matrix.rows.length === 8
    && matrix.xor === 8
    && matrix.both === 0
    && matrix.neither === 0;

  return {
    eventCount:
      matrix.rows.length,

    pairCoverage: {
      quickSilverOnly:
        quickRestorations.length,
      etherealBulletsOnly:
        etherealRestorations.length,
      both:
        matrix.both,
      neither:
        matrix.neither,
      xor:
        matrix.xor,
      exactPartition,
    },

    heroSupport: {
      quickSilver:
        quickHeroes,
      etherealBullets:
        etherealHeroes,
    },

    exposureRows,

    staticMechanismEvidence: {
      quickSilver:
        quickEvidence,
      etherealBullets:
        etherealEvidence,
    },

    classification:
      exactPartition
      && quickHeroes.length >= 2
      && etherealHeroes.length >= 2
        ? 'QUICK_SILVER_AND_ETHEREAL_BULLETS_EXACTLY_PARTITION_ALL_EIGHT_TEST_RESTORATIONS'
        : 'DUAL_ITEM_RESTORATION_PARTITION_NOT_ESTABLISHED',
  };
}

function collectScalars(
  value,
  path,
  rows,
) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    rows.push({
      path,
      value,
    });
    return;
  }

  if (typeof value !== 'object') return;

  if (Array.isArray(value)) {
    value.forEach(
      (child, i) =>
        collectScalars(
          child,
          `${path}[${i}]`,
          rows,
        ),
    );
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    collectScalars(
      child,
      `${path}.${key}`,
      rows,
    );
  }
}

function pairOrder(state) {
  switch (state) {
    case 'NEITHER':
      return 0;
    case 'QUICK_SILVER_ONLY':
      return 1;
    case 'ETHEREAL_BULLETS_ONLY':
      return 2;
    case 'BOTH':
      return 3;
    default:
      return 4;
  }
}
