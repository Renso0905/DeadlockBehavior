// Runtime magazine-capacity discovery helpers.
//
// Scientific boundary:
// - m_iClip is observed current clip state.
// - a repeated reload-exit plateau is an empirical capacity candidate.
// - static m_iClipSize / m_iBonusClip / m_flAmmoFrac are diagnostics only.
// - no item/buff/hero formula is composed here.

export const MAGAZINE_DISCOVERY_THRESHOLDS = Object.freeze({
  minCompletionLikeReloadsPerContext: 6,
  minEvaluableContexts: 5,
  minHoldoutReloadExits: 30,
  minHoldoutExactAgreementRate: 0.95,
  maxPostCalibrationOvershootRate: 0.01,
});

export function normalizeWeaponEvent(row, index = 0) {
  const tick = finite(firstDefined(
    row?.tick,
    row?.demoTick,
    row?.weapon?.tick,
    row?.observed?.tick,
    deepFindExactKey(row, 'tick'),
    deepFindExactKey(row, 'demoTick'),
  ));

  const heroId = finite(firstDefined(
    row?.heroId,
    row?.player?.heroId,
    row?.playerState?.heroId,
    deepFindExactKey(row, 'heroId'),
  ));

  const weaponEntityIndex = finite(firstDefined(
    row?.weaponEntityIndex,
    row?.weapon?.entityIndex,
    row?.weaponEntity?.entityIndex,
    row?.entityIndex,
    deepFindExactKey(row, 'weaponEntityIndex'),
  ));

  const playerKey = stringOrNull(firstDefined(
    row?.playerKey,
    row?.playerName,
    row?.player?.playerKey,
    row?.player?.playerName,
    row?.player?.steamId,
    row?.player?.steamID,
    deepFindExactKey(row, 'playerKey'),
    deepFindExactKey(row, 'playerName'),
  )) ?? (
    heroId !== null && weaponEntityIndex !== null
      ? `hero${heroId}:weapon${weaponEntityIndex}`
      : null
  );

  const effectContextId = stringOrNull(firstDefined(
    row?.effectContextId,
    row?.effectContext?.effectContextId,
    row?.effectContext?.id,
    row?.context?.effectContextId,
    deepFindExactKey(row, 'effectContextId'),
  )) ?? 'NO_EFFECT_CONTEXT_ID';

  const activeFireMode = finite(firstDefined(
    row?.m_eActiveFireMode,
    row?.observed?.m_eActiveFireMode,
    row?.weaponState?.m_eActiveFireMode,
    deepFindExactKey(row, 'm_eActiveFireMode'),
  )) ?? 0;

  return {
    sourceIndex: index,
    tick,
    heroId,
    playerKey,
    weaponEntityIndex,
    effectContextId,
    activeFireMode,

    clip: finite(fieldValue(row, 'm_iClip')),
    bonusClip: finite(fieldValue(row, 'm_iBonusClip')),
    ammoFrac: finite(fieldValue(row, 'm_flAmmoFrac')),
    inReload: booleanOrNull(fieldValue(row, 'm_bInReload')),

    raw: row,
  };
}

export function buildStaticWeaponProfiles(script165) {
  const profiles = new Map();

  walk(script165, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const heroId = finite(value.heroId);
    if (heroId === null) return;

    const clipSize = finite(deepFindExactKey(value, 'm_iClipSize'));
    const reloadSingleBullets = booleanOrNull(
      deepFindExactKey(value, 'm_bReloadSingleBullets'),
    );

    if (clipSize === null && reloadSingleBullets === null) return;

    const prior = profiles.get(heroId) ?? {
      heroId,
      displayName: value.displayName ?? null,
      staticClipSize: null,
      reloadSingleBullets: null,
    };

    if (prior.staticClipSize === null && clipSize !== null) {
      prior.staticClipSize = clipSize;
    }

    if (
      prior.reloadSingleBullets === null
      && reloadSingleBullets !== null
    ) {
      prior.reloadSingleBullets = reloadSingleBullets;
    }

    if (!prior.displayName && value.displayName) {
      prior.displayName = value.displayName;
    }

    profiles.set(heroId, prior);
  });

  return profiles;
}

export function findHeroClipScalingIds(script131) {
  const ids = new Set();

  walk(script131, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const heroId = finite(value.heroId);
    if (heroId === null) return;

    const scalingStats = Array.isArray(value.scalingStats)
      ? value.scalingStats
      : [];

    if (
      scalingStats.some(
        row => String(row?.recordKey ?? '').toUpperCase() === 'ECLIPSIZE',
      )
    ) {
      ids.add(heroId);
    }
  });

  return ids;
}

export function discoverReloadEpisodes(
  normalizedEvents,
  staticProfiles = new Map(),
  heroClipScalingIds = new Set(),
) {
  const events = normalizedEvents
    .filter(row => row?.tick !== null && row?.weaponEntityIndex !== null)
    .sort((a, b) => (
      a.tick - b.tick
      || a.sourceIndex - b.sourceIndex
    ));

  const stateByWeapon = new Map();
  const contexts = new Map();
  const allReloadExits = [];

  for (const row of events) {
    const weaponKey = `${row.playerKey ?? 'UNKNOWN'}|${row.weaponEntityIndex}`;
    const previous = stateByWeapon.get(weaponKey) ?? {
      clip: null,
      bonusClip: null,
      ammoFrac: null,
      inReload: null,
      effectContextId: row.effectContextId,
      activeFireMode: row.activeFireMode,
      heroId: row.heroId,
      reloadEpisode: null,
    };

    const current = {
      clip: row.clip ?? previous.clip,
      bonusClip: row.bonusClip ?? previous.bonusClip,
      ammoFrac: row.ammoFrac ?? previous.ammoFrac,
      inReload: row.inReload ?? previous.inReload,
      effectContextId: row.effectContextId ?? previous.effectContextId,
      activeFireMode: row.activeFireMode ?? previous.activeFireMode,
      heroId: row.heroId ?? previous.heroId,
      reloadEpisode: previous.reloadEpisode,
    };

    if (previous.inReload !== true && current.inReload === true) {
      current.reloadEpisode = {
        startTick: row.tick,
        startClip: current.clip,
        maxClipDuringReload: current.clip,
        effectContextId: current.effectContextId,
        activeFireMode: current.activeFireMode,
        heroId: current.heroId,
      };
    }

    if (
      current.reloadEpisode
      && Number.isFinite(current.clip)
    ) {
      current.reloadEpisode.maxClipDuringReload = maxFinite(
        current.reloadEpisode.maxClipDuringReload,
        current.clip,
      );
    }

    if (previous.inReload === true && current.inReload === false) {
      const episode = previous.reloadEpisode ?? current.reloadEpisode;
      const startClip = finite(episode?.startClip);
      const exitClip = finite(current.clip);
      const clipGain = (
        startClip !== null && exitClip !== null
          ? exitClip - startClip
          : null
      );

      const heroId = current.heroId;
      const staticProfile = staticProfiles.get(heroId) ?? null;
      const singleBulletReload =
        staticProfile?.reloadSingleBullets === true;
      const heroClipScaling =
        heroClipScalingIds.has(heroId);

      const contextKey = makeContextKey({
        playerKey: row.playerKey,
        weaponEntityIndex: row.weaponEntityIndex,
        effectContextId: current.effectContextId,
        activeFireMode: current.activeFireMode,
      });

      const exit = {
        contextKey,
        tick: row.tick,
        heroId,
        playerKey: row.playerKey,
        weaponEntityIndex: row.weaponEntityIndex,
        effectContextId: current.effectContextId,
        activeFireMode: current.activeFireMode,

        startTick: finite(episode?.startTick),
        startClip,
        exitClip,
        clipGain,
        bonusClip: finite(current.bonusClip),
        ammoFrac: finite(current.ammoFrac),

        completionLike:
          startClip !== null
          && exitClip !== null
          && exitClip > startClip,

        singleBulletReload,
        heroClipScaling,
        staticClipSize: staticProfile?.staticClipSize ?? null,
      };

      allReloadExits.push(exit);

      const context = getOrCreateContext(
        contexts,
        contextKey,
        {
          heroId,
          playerKey: row.playerKey,
          weaponEntityIndex: row.weaponEntityIndex,
          effectContextId: current.effectContextId,
          activeFireMode: current.activeFireMode,
          staticClipSize: staticProfile?.staticClipSize ?? null,
          singleBulletReload,
          heroClipScaling,
        },
      );

      context.reloadExits.push(exit);
      if (exit.completionLike) {
        context.completionLikeReloadExits.push(exit);
      }

      current.reloadEpisode = null;
    }

    const contextKey = makeContextKey({
      playerKey: row.playerKey,
      weaponEntityIndex: row.weaponEntityIndex,
      effectContextId: current.effectContextId,
      activeFireMode: current.activeFireMode,
    });

    const staticProfile = staticProfiles.get(current.heroId) ?? null;
    const context = getOrCreateContext(
      contexts,
      contextKey,
      {
        heroId: current.heroId,
        playerKey: row.playerKey,
        weaponEntityIndex: row.weaponEntityIndex,
        effectContextId: current.effectContextId,
        activeFireMode: current.activeFireMode,
        staticClipSize: staticProfile?.staticClipSize ?? null,
        singleBulletReload:
          staticProfile?.reloadSingleBullets === true,
        heroClipScaling:
          heroClipScalingIds.has(current.heroId),
      },
    );

    if (Number.isFinite(current.clip)) {
      context.clipObservations.push({
        tick: row.tick,
        clip: current.clip,
        bonusClip: current.bonusClip,
        ammoFrac: current.ammoFrac,
      });
    }

    stateByWeapon.set(weaponKey, current);
  }

  return {
    contexts: [...contexts.values()],
    allReloadExits,
  };
}

export function evaluateMagazineContexts(
  contexts,
  thresholds = MAGAZINE_DISCOVERY_THRESHOLDS,
) {
  const evaluated = contexts.map(
    context => evaluateMagazineContext(context, thresholds),
  );

  const primary = evaluated.filter(row => row.primaryEligible);
  const holdoutRows = primary.flatMap(row => row.holdoutComparisons);

  const totalHoldout = holdoutRows.length;
  const holdoutAligned = holdoutRows.filter(row => row.exact).length;

  const overshootComparable = primary.reduce(
    (sum, row) => sum + row.postCalibrationClipObservations,
    0,
  );
  const overshoots = primary.reduce(
    (sum, row) => sum + row.postCalibrationOvershoots,
    0,
  );

  const summary = {
    contextCount: evaluated.length,
    primaryEligibleContexts: primary.length,
    primaryStableContexts:
      primary.filter(row => row.contextPass).length,

    holdoutReloadExits: totalHoldout,
    holdoutExactMatches: holdoutAligned,
    holdoutExactAgreementRate:
      totalHoldout > 0 ? holdoutAligned / totalHoldout : null,

    postCalibrationClipObservations: overshootComparable,
    postCalibrationOvershoots: overshoots,
    postCalibrationOvershootRate:
      overshootComparable > 0 ? overshoots / overshootComparable : null,

    primaryContextPassRate:
      primary.length > 0
        ? primary.filter(row => row.contextPass).length / primary.length
        : null,
  };

  const strong =
    summary.primaryEligibleContexts >= thresholds.minEvaluableContexts
    && summary.holdoutReloadExits >= thresholds.minHoldoutReloadExits
    && summary.holdoutExactAgreementRate !== null
    && summary.holdoutExactAgreementRate
      >= thresholds.minHoldoutExactAgreementRate
    && summary.postCalibrationOvershootRate !== null
    && summary.postCalibrationOvershootRate
      <= thresholds.maxPostCalibrationOvershootRate;

  return {
    contexts: evaluated,
    summary,
    classification: strong
      ? 'RELOAD_EXIT_CLIP_PLATEAU_IS_STRONG_RUNTIME_MAGAZINE_CAPACITY_CANDIDATE'
      : 'RUNTIME_MAGAZINE_CAPACITY_RELOAD_PLATEAU_REQUIRES_DIAGNOSIS',
  };
}

export function evaluateMagazineContext(
  context,
  thresholds = MAGAZINE_DISCOVERY_THRESHOLDS,
) {
  const exits = [...context.completionLikeReloadExits]
    .filter(row => Number.isFinite(row.exitClip))
    .sort((a, b) => a.tick - b.tick);

  const enoughReloads =
    exits.length >= thresholds.minCompletionLikeReloadsPerContext;

  const primaryEligible =
    enoughReloads
    && context.singleBulletReload !== true
    && context.heroClipScaling !== true;

  if (!enoughReloads) {
    return {
      ...compactContext(context),
      completionLikeReloads: exits.length,
      primaryEligible: false,
      exclusionReason:
        'INSUFFICIENT_COMPLETION_LIKE_RELOAD_EXITS',
      calibrationCount: 0,
      holdoutCount: 0,
      candidateCapacity: null,
      calibrationModeDominance: null,
      holdoutExactAgreementRate: null,
      postCalibrationOvershootRate: null,
      contextPass: false,
      holdoutComparisons: [],
      diagnostic: buildStaticDiagnostics(context, exits, null),
    };
  }

  const calibrationCount = Math.max(
    3,
    Math.floor(exits.length / 2),
  );

  const calibration = exits.slice(0, calibrationCount);
  const holdout = exits.slice(calibrationCount);

  const mode = uniqueMode(calibration.map(row => row.exitClip));
  const candidateCapacity = mode?.value ?? null;
  const calibrationModeDominance =
    mode
      ? mode.count / calibration.length
      : null;

  const holdoutComparisons = holdout.map(row => ({
    tick: row.tick,
    observedExitClip: row.exitClip,
    candidateCapacity,
    exact:
      candidateCapacity !== null
      && row.exitClip === candidateCapacity,
  }));

  const holdoutExactMatches =
    holdoutComparisons.filter(row => row.exact).length;

  const holdoutExactAgreementRate =
    holdoutComparisons.length > 0
      ? holdoutExactMatches / holdoutComparisons.length
      : null;

  const calibrationEndTick =
    calibration.length > 0 ? calibration.at(-1).tick : null;

  const postCalibrationRows =
    candidateCapacity === null
      ? []
      : context.clipObservations.filter(
        row =>
          Number.isFinite(row.clip)
          && calibrationEndTick !== null
          && row.tick > calibrationEndTick,
      );

  const postCalibrationOvershoots =
    candidateCapacity === null
      ? []
      : postCalibrationRows.filter(
        row => row.clip > candidateCapacity,
      );

  const postCalibrationOvershootRate =
    postCalibrationRows.length > 0
      ? postCalibrationOvershoots.length / postCalibrationRows.length
      : null;

  let exclusionReason = null;
  if (context.singleBulletReload === true) {
    exclusionReason = 'STATIC_SINGLE_BULLET_RELOAD';
  } else if (context.heroClipScaling === true) {
    exclusionReason = 'SCRIPT131_ECLIPSIZE_SCALING_HERO';
  } else if (!mode) {
    exclusionReason = 'CALIBRATION_MODE_TIE_OR_EMPTY';
  }

  const contextPass =
    primaryEligible
    && candidateCapacity !== null
    && holdoutExactAgreementRate !== null
    && holdoutExactAgreementRate
      >= thresholds.minHoldoutExactAgreementRate
    && postCalibrationOvershootRate !== null
    && postCalibrationOvershootRate
      <= thresholds.maxPostCalibrationOvershootRate;

  return {
    ...compactContext(context),
    completionLikeReloads: exits.length,
    primaryEligible,
    exclusionReason,

    calibrationCount: calibration.length,
    holdoutCount: holdout.length,
    candidateCapacity,
    calibrationModeDominance,

    holdoutExactMatches,
    holdoutExactAgreementRate,
    holdoutComparisons,

    postCalibrationClipObservations:
      postCalibrationRows.length,
    postCalibrationOvershoots:
      postCalibrationOvershoots.length,
    postCalibrationOvershootRate,

    contextPass,

    diagnostic:
      buildStaticDiagnostics(
        context,
        exits,
        candidateCapacity,
      ),
  };
}

export function uniqueMode(values) {
  const counts = new Map();

  for (const value of values.filter(Number.isFinite)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

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

function buildStaticDiagnostics(
  context,
  exits,
  candidateCapacity,
) {
  const staticClipSize = finite(context.staticClipSize);

  const staticComparable = exits.filter(
    row =>
      staticClipSize !== null
      && Number.isFinite(row.exitClip),
  );

  const staticExact =
    staticComparable.filter(
      row => row.exitClip === staticClipSize,
    ).length;

  const staticPlusBonusComparable = exits.filter(
    row =>
      staticClipSize !== null
      && Number.isFinite(row.exitClip)
      && Number.isFinite(row.bonusClip),
  );

  const staticPlusBonusExact =
    staticPlusBonusComparable.filter(
      row =>
        row.exitClip
        === staticClipSize + row.bonusClip,
    ).length;

  const ammoFracAtExit =
    exits
      .map(row => row.ammoFrac)
      .filter(Number.isFinite);

  return {
    staticClipSize,
    candidateMinusStatic:
      candidateCapacity !== null && staticClipSize !== null
        ? candidateCapacity - staticClipSize
        : null,

    staticExact: {
      aligned: staticExact,
      comparable: staticComparable.length,
      rate:
        staticComparable.length > 0
          ? staticExact / staticComparable.length
          : null,
    },

    staticPlusBonusExact: {
      aligned: staticPlusBonusExact,
      comparable: staticPlusBonusComparable.length,
      rate:
        staticPlusBonusComparable.length > 0
          ? staticPlusBonusExact
            / staticPlusBonusComparable.length
          : null,
    },

    bonusClipValues:
      [...new Set(
        exits
          .map(row => row.bonusClip)
          .filter(Number.isFinite),
      )].sort((a, b) => a - b),

    ammoFracAtReloadExit: {
      count: ammoFracAtExit.length,
      zeroish:
        ammoFracAtExit.filter(value => Math.abs(value) <= 1e-6).length,
      zeroishRate:
        ammoFracAtExit.length > 0
          ? ammoFracAtExit.filter(
            value => Math.abs(value) <= 1e-6,
          ).length / ammoFracAtExit.length
          : null,
    },
  };
}

function compactContext(context) {
  return {
    contextKey: context.contextKey,
    heroId: context.heroId,
    playerKey: context.playerKey,
    weaponEntityIndex: context.weaponEntityIndex,
    effectContextId: context.effectContextId,
    activeFireMode: context.activeFireMode,
    staticClipSize: context.staticClipSize,
    singleBulletReload: context.singleBulletReload,
    heroClipScaling: context.heroClipScaling,
    reloadExits: context.reloadExits.length,
    clipObservations: context.clipObservations.length,
  };
}

function getOrCreateContext(map, key, seed) {
  if (!map.has(key)) {
    map.set(key, {
      contextKey: key,
      ...seed,
      reloadExits: [],
      completionLikeReloadExits: [],
      clipObservations: [],
    });
  }

  return map.get(key);
}

function makeContextKey({
  playerKey,
  weaponEntityIndex,
  effectContextId,
  activeFireMode,
}) {
  return [
    playerKey ?? 'UNKNOWN_PLAYER',
    weaponEntityIndex ?? 'UNKNOWN_WEAPON',
    effectContextId ?? 'NO_EFFECT_CONTEXT_ID',
    activeFireMode ?? 0,
  ].join('|');
}

function fieldValue(row, key) {
  return firstDefined(
    row?.observed?.[key],
    row?.weaponState?.[key],
    row?.weapon?.[key],
    row?.state?.[key],
    row?.[key],
    deepFindExactKey(row, key),
  );
}

export function deepFindExactKey(root, key, maxDepth = 8) {
  if (!root || typeof root !== 'object') return undefined;

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
      && Object.prototype.hasOwnProperty.call(value, key)
    ) {
      return value[key];
    }

    const children = Array.isArray(value)
      ? value
      : Object.values(value);

    for (const child of children) {
      if (child && typeof child === 'object') {
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
    value => value !== undefined && value !== null,
  );
}

function finite(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  if (value === true || value === false) return value;

  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }

  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }

  return null;
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > 0 ? text : null;
}

function maxFinite(a, b) {
  const aa = finite(a);
  const bb = finite(b);

  if (aa === null) return bb;
  if (bb === null) return aa;
  return Math.max(aa, bb);
}
