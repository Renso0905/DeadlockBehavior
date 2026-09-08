// Script182 V02 structural join helper.
//
// V01 attempted to join attack samples directly through
// CCitadelPlayerPawn.m_nHeroID and recovered 0/37,571 attack samples.
//
// V02 uses the established runtime relationship:
//
//   attack sample heroId
//     -> CCitadelPlayerController.m_nHeroID
//     -> controller.m_hHeroPawn / m_hPawn
//     -> CCitadelPlayerPawn
//
// This helper changes only replay-state joining. It does not alter any slide
// candidate scoring or scientific thresholds.

export const INVALID_ENTITY_HANDLE = 16777215;

export function validEntityHandle(handle) {
  return (
    handle !== undefined
    && handle !== null
    && handle !== INVALID_ENTITY_HANDLE
  );
}

export function controllerHeroId(controller) {
  if (!controller) return null;

  const value =
    controller.getField(
      'm_nHeroID',
    );

  const number =
    Number(value);

  return Number.isFinite(number)
    && number > 0
      ? number
      : null;
}

export function controllerPawnHandle(controller) {
  if (!controller) return null;

  const heroPawn =
    controller.getField(
      'm_hHeroPawn',
    );

  if (validEntityHandle(heroPawn)) {
    return {
      handle: heroPawn,
      field: 'm_hHeroPawn',
    };
  }

  const pawn =
    controller.getField(
      'm_hPawn',
    );

  if (validEntityHandle(pawn)) {
    return {
      handle: pawn,
      field: 'm_hPawn',
    };
  }

  return null;
}

export function resolvePawnForHero({
  demo,
  controllers,
  heroId,
}) {
  const targetHeroId =
    Number(heroId);

  if (
    !demo
    || !Number.isFinite(targetHeroId)
  ) {
    return {
      pawn: null,
      controller: null,
      provenance:
        'INVALID_JOIN_INPUT',
      matchingControllers: 0,
    };
  }

  const matching =
    (controllers ?? [])
      .filter(
        controller =>
          controllerHeroId(controller)
          === targetHeroId,
      );

  if (matching.length !== 1) {
    return {
      pawn: null,
      controller: null,
      provenance:
        matching.length === 0
          ? 'NO_CONTROLLER_FOR_HERO'
          : 'AMBIGUOUS_CONTROLLERS_FOR_HERO',
      matchingControllers:
        matching.length,
    };
  }

  const controller =
    matching[0];

  const resolvedHandle =
    controllerPawnHandle(
      controller,
    );

  if (!resolvedHandle) {
    return {
      pawn: null,
      controller,
      provenance:
        'CONTROLLER_HAS_NO_VALID_PAWN_HANDLE',
      matchingControllers: 1,
    };
  }

  let pawn = null;

  try {
    pawn =
      demo.getEntityByHandle(
        resolvedHandle.handle,
      );
  } catch {
    pawn = null;
  }

  if (!pawn) {
    return {
      pawn: null,
      controller,
      pawnHandle:
        resolvedHandle.handle,
      pawnHandleField:
        resolvedHandle.field,
      provenance:
        'PAWN_HANDLE_DID_NOT_RESOLVE',
      matchingControllers: 1,
    };
  }

  if (
    pawn?.class?.name
    !== 'CCitadelPlayerPawn'
  ) {
    return {
      pawn: null,
      controller,
      pawnHandle:
        resolvedHandle.handle,
      pawnHandleField:
        resolvedHandle.field,
      resolvedClass:
        pawn?.class?.name ?? null,
      provenance:
        'PAWN_HANDLE_RESOLVED_WRONG_CLASS',
      matchingControllers: 1,
    };
  }

  return {
    pawn,
    controller,
    pawnHandle:
      resolvedHandle.handle,
    pawnHandleField:
      resolvedHandle.field,
    provenance:
      'CONTROLLER_HERO_TO_PAWN_HANDLE',
    matchingControllers: 1,
  };
}

export function createAttackTickGuard() {
  const processed =
    new Set();

  let duplicateDemoPacketHits =
    0;

  return {
    shouldProcess(tick) {
      if (!Number.isFinite(tick)) {
        return false;
      }

      if (processed.has(tick)) {
        duplicateDemoPacketHits++;
        return false;
      }

      processed.add(tick);
      return true;
    },

    get processedTickCount() {
      return processed.size;
    },

    get duplicateDemoPacketHits() {
      return duplicateDemoPacketHits;
    },
  };
}
