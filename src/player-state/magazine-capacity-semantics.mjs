// Script175 helpers: semantic diagnostics for the Script174 V02
// reload-exit plateau magazine-capacity candidate.
//
// This module does NOT compose a capacity formula. It tests:
// 1. whether the candidate is the empirical m_iClip ceiling within context;
// 2. whether reload-exit m_iClip later settles upward without a new shot;
// 3. how observed firing decrements relate to static m_iAmmoConsumedPerShot.

export const MAGAZINE_SEMANTIC_THRESHOLDS = Object.freeze({
  settlementWindowTicks: 4,
  minCandidateContexts: 30,
  minCandidateReloadExits: 300,
  minContextCeilingAgreementRate: 0.95,
  maxReloadExitUpwardSettlementRate: 0.01,
});

export function normalizeSemanticWeaponEvent(row, index = 0) {
  const observed = row?.observedWeaponState ?? {};

  return {
    sourceIndex: index,
    tick: finite(firstDefined(
      row?.tick,
      row?.demoTick,
      deepFindExactKey(row, 'tick'),
    )),
    heroId: finite(firstDefined(
      row?.heroId,
      row?.player?.heroId,
      deepFindExactKey(row, 'heroId'),
    )),
    playerKey: stringOrNull(firstDefined(
      row?.playerKey,
      row?.playerName,
      row?.player?.playerKey,
      deepFindExactKey(row, 'playerKey'),
      deepFindExactKey(row, 'playerName'),
    )),
    weaponEntityIndex: finite(firstDefined(
      row?.weaponEntityIndex,
      row?.weapon?.entityIndex,
      deepFindExactKey(row, 'weaponEntityIndex'),
    )),
    effectContextId: stringOrNull(firstDefined(
      row?.effectContextId,
      row?.effectContext?.effectContextId,
      deepFindExactKey(row, 'effectContextId'),
    )) ?? 'NO_EFFECT_CONTEXT_ID',
    activeFireMode: finite(firstDefined(
      observed?.activeFireMode,
      deepFindExactKey(row, 'm_eActiveFireMode'),
      deepFindExactKey(row, 'activeFireMode'),
    )) ?? 0,

    clip: finite(firstDefined(
      observed?.clip,
      deepFindExactKey(row, 'm_iClip'),
      deepFindExactKey(row, 'clip'),
    )),
    bonusClip: finite(firstDefined(
      observed?.bonusClip,
      deepFindExactKey(row, 'm_iBonusClip'),
      deepFindExactKey(row, 'bonusClip'),
    )),
    ammoFraction: finite(firstDefined(
      observed?.ammoFraction,
      deepFindExactKey(row, 'm_flAmmoFrac'),
      deepFindExactKey(row, 'ammoFraction'),
    )),
    inReload: booleanOrNull(firstDefined(
      observed?.inReload,
      deepFindExactKey(row, 'm_bInReload'),
      deepFindExactKey(row, 'inReload'),
    )),
    shotNumber: finite(firstDefined(
      observed?.shotNumber,
      deepFindExactKey(row, 'm_nShotNumber'),
      deepFindExactKey(row, 'shotNumber'),
    )),
    lastAttackTime: finite(firstDefined(
      observed?.lastAttackTime,
      deepFindExactKey(row, 'm_flLastAttackTime'),
      deepFindExactKey(row, 'lastAttackTime'),
    )),
  };
}

export function candidateContextMap(script174) {
  const map = new Map();

  const contexts = script174?.evaluation?.contexts ?? [];
  for (const row of contexts) {
    if (
      row?.primaryEligible === true
      && Number.isFinite(row?.candidateCapacity)
    ) {
      map.set(row.contextKey, {
        contextKey: row.contextKey,
        heroId: finite(row.heroId),
        playerKey: stringOrNull(row.playerKey),
        weaponEntityIndex: finite(row.weaponEntityIndex),
        effectContextId:
          stringOrNull(row.effectContextId)
          ?? 'NO_EFFECT_CONTEXT_ID',
        activeFireMode:
          finite(row.activeFireMode) ?? 0,
        candidateCapacity: finite(row.candidateCapacity),
        completionLikeReloads:
          finite(row.completionLikeReloads) ?? 0,
        contextPass: row.contextPass === true,
        staticClipSize: finite(row.staticClipSize),
      });
    }
  }

  return map;
}

export function attachEventsToCandidateContexts(events, candidates) {
  const grouped = new Map();

  for (const [key, candidate] of candidates) {
    grouped.set(key, {
      ...candidate,
      events: [],
    });
  }

  for (const row of events) {
    const key = makeContextKey(row);
    const context = grouped.get(key);
    if (context) context.events.push(row);
  }

  for (const context of grouped.values()) {
    context.events.sort((a, b) => (
      a.tick - b.tick
      || a.sourceIndex - b.sourceIndex
    ));
  }

  return [...grouped.values()];
}

export function diagnoseContextCeiling(context) {
  const clips = context.events
    .map(row => row.clip)
    .filter(Number.isFinite);

  const maxObservedClip =
    clips.length > 0 ? Math.max(...clips) : null;

  const overshoots =
    Number.isFinite(context.candidateCapacity)
      ? clips.filter(
        clip => clip > context.candidateCapacity,
      ).length
      : 0;

  return {
    contextKey: context.contextKey,
    heroId: context.heroId,
    candidateCapacity: context.candidateCapacity,
    observations: clips.length,
    maxObservedClip,
    exactCeiling:
      Number.isFinite(maxObservedClip)
      && maxObservedClip === context.candidateCapacity,
    overshoots,
    overshootRate:
      clips.length > 0 ? overshoots / clips.length : null,
  };
}

export function findReloadExits(events) {
  const exits = [];
  let previous = null;

  for (const row of events) {
    if (
      previous
      && previous.inReload === true
      && row.inReload === false
    ) {
      exits.push({
        tick: row.tick,
        sourceIndex: row.sourceIndex,
        exitClip: row.clip,
        shotNumber: row.shotNumber,
        lastAttackTime: row.lastAttackTime,
      });
    }

    previous = row;
  }

  return exits;
}

export function diagnoseReloadExitSettlement(
  context,
  windowTicks =
    MAGAZINE_SEMANTIC_THRESHOLDS.settlementWindowTicks,
) {
  const exits = findReloadExits(context.events);

  const rows = exits.map(exit => {
    let maxSameShotClip = exit.exitClip;
    let comparable = Number.isFinite(exit.exitClip);

    for (const row of context.events) {
      if (row.tick < exit.tick) continue;
      if (row.tick > exit.tick + windowTicks) break;

      if (
        Number.isFinite(exit.shotNumber)
        && Number.isFinite(row.shotNumber)
        && row.shotNumber !== exit.shotNumber
      ) {
        break;
      }

      if (
        Number.isFinite(exit.lastAttackTime)
        && Number.isFinite(row.lastAttackTime)
        && row.lastAttackTime > exit.lastAttackTime + 1e-9
      ) {
        break;
      }

      if (Number.isFinite(row.clip)) {
        comparable = true;
        maxSameShotClip =
          Number.isFinite(maxSameShotClip)
            ? Math.max(maxSameShotClip, row.clip)
            : row.clip;
      }
    }

    return {
      tick: exit.tick,
      exitClip: exit.exitClip,
      maxSameShotClip,
      comparable,
      increasedWithoutShot:
        comparable
        && Number.isFinite(exit.exitClip)
        && Number.isFinite(maxSameShotClip)
        && maxSameShotClip > exit.exitClip,
    };
  });

  const comparableRows =
    rows.filter(row => row.comparable);

  const increased =
    comparableRows.filter(
      row => row.increasedWithoutShot,
    ).length;

  return {
    exits: rows.length,
    comparable: comparableRows.length,
    increasedWithoutShot: increased,
    upwardSettlementRate:
      comparableRows.length > 0
        ? increased / comparableRows.length
        : null,
    rows,
  };
}

export function diagnoseFiringClipDecrements(context) {
  const decrements = [];
  let previous = null;

  for (const row of context.events) {
    if (!previous) {
      previous = row;
      continue;
    }

    const shotAdvanced =
      Number.isFinite(previous.shotNumber)
      && Number.isFinite(row.shotNumber)
      && row.shotNumber > previous.shotNumber;

    const lastAttackAdvanced =
      Number.isFinite(previous.lastAttackTime)
      && Number.isFinite(row.lastAttackTime)
      && row.lastAttackTime > previous.lastAttackTime + 1e-9;

    const discharge =
      shotAdvanced || lastAttackAdvanced;

    if (
      discharge
      && previous.inReload !== true
      && row.inReload !== true
      && Number.isFinite(previous.clip)
      && Number.isFinite(row.clip)
      && previous.clip > row.clip
    ) {
      decrements.push(previous.clip - row.clip);
    }

    previous = row;
  }

  const mode = uniqueMode(decrements);

  return {
    observations: decrements.length,
    modeDecrement: mode?.value ?? null,
    modeCount: mode?.count ?? 0,
    modeDominance:
      decrements.length > 0 && mode
        ? mode.count / decrements.length
        : null,
    uniqueDecrements:
      [...new Set(decrements)].sort((a, b) => a - b),
  };
}

export function extractStaticAmmoProfiles(script165) {
  const profiles = new Map();

  walk(script165, value => {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
    ) {
      return;
    }

    const heroId = finite(value.heroId);
    if (heroId === null) return;

    const clipSize = finite(
      deepFindExactKey(value, 'm_iClipSize'),
    );
    const ammoConsumed = finite(
      deepFindExactKey(value, 'm_iAmmoConsumedPerShot'),
    );

    if (clipSize === null && ammoConsumed === null) {
      return;
    }

    const prior = profiles.get(heroId) ?? {
      heroId,
      displayName:
        stringOrNull(value.displayName),
      staticClipSize: null,
      ammoConsumedPerShot: null,
    };

    if (
      prior.staticClipSize === null
      && clipSize !== null
    ) {
      prior.staticClipSize = clipSize;
    }

    if (
      prior.ammoConsumedPerShot === null
      && ammoConsumed !== null
    ) {
      prior.ammoConsumedPerShot = ammoConsumed;
    }

    profiles.set(heroId, prior);
  });

  return profiles;
}

export function compareContextToStatic(
  context,
  decrementDiagnostic,
  staticProfile,
) {
  const candidate =
    finite(context.candidateCapacity);
  const staticClip =
    finite(staticProfile?.staticClipSize);
  const ammoConsumed =
    finite(staticProfile?.ammoConsumedPerShot);
  const observedDecrement =
    finite(decrementDiagnostic?.modeDecrement);

  return {
    heroId: context.heroId,
    contextKey: context.contextKey,
    candidateCapacity: candidate,
    staticClipSize: staticClip,
    staticAmmoConsumedPerShot: ammoConsumed,
    observedModeClipDecrement: observedDecrement,

    candidateEqualsStatic:
      candidate !== null
      && staticClip !== null
      ? candidate === staticClip
      : null,

    candidateTimesStaticAmmoConsumed:
      candidate !== null
      && ammoConsumed !== null
      ? candidate * ammoConsumed
      : null,

    candidateTimesObservedDecrement:
      candidate !== null
      && observedDecrement !== null
      ? candidate * observedDecrement
      : null,

    staticOverCandidate:
      candidate && staticClip !== null
      ? staticClip / candidate
      : null,
  };
}

export function summarizeMagazineSemantics(
  contexts,
  staticProfiles,
  thresholds = MAGAZINE_SEMANTIC_THRESHOLDS,
) {
  const rows = contexts.map(context => {
    const ceiling =
      diagnoseContextCeiling(context);
    const settlement =
      diagnoseReloadExitSettlement(
        context,
        thresholds.settlementWindowTicks,
      );
    const decrement =
      diagnoseFiringClipDecrements(context);
    const staticComparison =
      compareContextToStatic(
        context,
        decrement,
        staticProfiles.get(context.heroId),
      );

    return {
      contextKey: context.contextKey,
      heroId: context.heroId,
      candidateCapacity:
        context.candidateCapacity,
      completionLikeReloads:
        context.completionLikeReloads,
      contextPass:
        context.contextPass,
      ceiling,
      settlement,
      decrement,
      staticComparison,
    };
  });

  const totalCandidateReloads =
    rows.reduce(
      (sum, row) =>
        sum + (row.completionLikeReloads ?? 0),
      0,
    );

  const exactCeilingContexts =
    rows.filter(row => row.ceiling.exactCeiling).length;

  const settlementComparable =
    rows.reduce(
      (sum, row) =>
        sum + row.settlement.comparable,
      0,
    );

  const settlementIncreased =
    rows.reduce(
      (sum, row) =>
        sum + row.settlement.increasedWithoutShot,
      0,
    );

  const summary = {
    candidateContexts: rows.length,
    candidateReloadExits: totalCandidateReloads,

    exactCeilingContexts,
    contextCeilingAgreementRate:
      rows.length > 0
        ? exactCeilingContexts / rows.length
        : null,

    reloadExitSettlementComparable:
      settlementComparable,
    reloadExitUpwardSettlements:
      settlementIncreased,
    reloadExitUpwardSettlementRate:
      settlementComparable > 0
        ? settlementIncreased
          / settlementComparable
        : null,

    contextsWithFiringDecrementEvidence:
      rows.filter(
        row => row.decrement.observations > 0,
      ).length,
  };

  const strongCeiling =
    summary.candidateContexts
      >= thresholds.minCandidateContexts
    && summary.candidateReloadExits
      >= thresholds.minCandidateReloadExits
    && summary.contextCeilingAgreementRate !== null
    && summary.contextCeilingAgreementRate
      >= thresholds.minContextCeilingAgreementRate
    && summary.reloadExitUpwardSettlementRate !== null
    && summary.reloadExitUpwardSettlementRate
      <= thresholds.maxReloadExitUpwardSettlementRate;

  return {
    rows,
    summary,
    classification: strongCeiling
      ? 'RELOAD_EXIT_PLATEAU_SUPPORTED_AS_OBSERVED_RUNTIME_CLIP_CEILING_STATIC_MAPPING_UNRESOLVED'
      : 'RELOAD_EXIT_PLATEAU_CAPACITY_SEMANTICS_REQUIRE_DIAGNOSIS',
  };
}

function makeContextKey(row) {
  return [
    row.playerKey ?? 'UNKNOWN_PLAYER',
    row.weaponEntityIndex ?? 'UNKNOWN_WEAPON',
    row.effectContextId ?? 'NO_EFFECT_CONTEXT_ID',
    row.activeFireMode ?? 0,
  ].join('|');
}

function uniqueMode(values) {
  const counts = new Map();

  for (const value of values.filter(Number.isFinite)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const ordered =
    [...counts.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
          || a[0] - b[0],
      );

  if (
    ordered.length > 1
    && ordered[0][1] === ordered[1][1]
  ) {
    return null;
  }

  return {
    value: ordered[0][0],
    count: ordered[0][1],
  };
}

export function deepFindExactKey(
  root,
  key,
  maxDepth = 8,
) {
  if (!root || typeof root !== 'object') {
    return undefined;
  }

  const seen = new Set();
  const queue = [{ value: root, depth: 0 }];

  while (queue.length) {
    const { value, depth } = queue.shift();

    if (
      !value
      || typeof value !== 'object'
      || seen.has(value)
      || depth > maxDepth
    ) {
      continue;
    }

    seen.add(value);

    if (
      !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(
        value,
        key,
      )
    ) {
      return value[key];
    }

    for (
      const child
      of (
        Array.isArray(value)
          ? value
          : Object.values(value)
      )
    ) {
      if (
        child
        && typeof child === 'object'
      ) {
        queue.push({
          value: child,
          depth: depth + 1,
        });
      }
    }
  }

  return undefined;
}

function walk(root, visitor, maxDepth = 10) {
  const seen = new Set();

  function visit(value, depth) {
    if (
      !value
      || typeof value !== 'object'
      || seen.has(value)
      || depth > maxDepth
    ) {
      return;
    }

    seen.add(value);
    visitor(value);

    for (const child of Object.values(value)) {
      visit(child, depth + 1);
    }
  }

  visit(root, 0);
}

function firstDefined(...values) {
  return values.find(
    value =>
      value !== undefined
      && value !== null,
  );
}

function finite(value) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number)
    ? number
    : null;
}

function booleanOrNull(value) {
  if (value === true || value === false) {
    return value;
  }

  if (
    value === 1
    || value === '1'
    || value === 'true'
  ) {
    return true;
  }

  if (
    value === 0
    || value === '0'
    || value === 'false'
  ) {
    return false;
  }

  return null;
}

function stringOrNull(value) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  const text = String(value);
  return text.length > 0 ? text : null;
}
