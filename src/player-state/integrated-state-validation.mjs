import { isDeepStrictEqual } from 'node:util';

import {
  applyStateEvent,
  emptyPlayerState,
} from './runtime-state-timeline.mjs';

const DEFAULT_TICKS_PER_SECOND = 64;
const DEFAULT_BRIDGE_DURATION_SECONDS = 160;
const EPSILON = 1e-6;

export function validateIntegratedPlayerStateArtifact(
  artifact,
  {
    ticksPerSecond = DEFAULT_TICKS_PER_SECOND,
    bridgeDurationSeconds = DEFAULT_BRIDGE_DURATION_SECONDS,
  } = {},
) {
  const players = Array.isArray(artifact?.players) ? artifact.players : [];
  const intervals = (Array.isArray(artifact?.bridgeIntervals) ? artifact.bridgeIntervals : [])
    .map(row => ({ ...row, playerKey: row?.playerKey ?? row?.playerName ?? null }));
  const itemEffectRefs = new Set(
    (artifact?.resourceEffectInputs?.standardShopItems ?? [])
      .map(row => row?.ref)
      .filter(Boolean),
  );
  const heroProfileRefs = new Set(
    (artifact?.resourceEffectInputs?.heroProfiles ?? [])
      .map(row => row?.ref)
      .filter(Boolean),
  );
  const durationTicks = Math.round(bridgeDurationSeconds * ticksPerSecond);
  const contradictions = [];

  let timelineEvents = 0;
  let itemAdds = 0;
  let itemRemoves = 0;
  let permanentStateEvents = 0;
  let bridgeProjectedEventChecks = 0;
  let finalStateChecks = 0;
  let identityChecks = 0;
  const permanentFamiliesObserved = new Set();

  const checkFlags = {
    artifactShapeUsable: true,
    eventTicksStrictlyIncreasing: true,
    finalStateReconstructionExact: true,
    itemOwnershipTransitionsCoherent: true,
    itemEffectReferencesResolved: true,
    stableResolvedIdentity: true,
    permanentBuffStateFiniteNonnegative: true,
    permanentBuffStateMonotonic: true,
    bridgeIntervalsWellFormed: true,
    bridgeBoundaryEventsPresent: true,
    bridgeProjectionExactAtAllEvents: true,
  };

  if (!artifact || typeof artifact !== 'object' || players.length === 0) {
    checkFlags.artifactShapeUsable = false;
    contradictions.push({ code: 'ARTIFACT_SHAPE_UNUSABLE', detail: 'Artifact is missing or has no players.' });
  }

  const playersByKey = new Map();
  for (const player of players) {
    const playerKey = player?.playerKey ?? player?.identity?.playerName ?? null;
    if (!playerKey) {
      checkFlags.artifactShapeUsable = false;
      contradictions.push({ code: 'PLAYER_KEY_MISSING' });
      continue;
    }
    playersByKey.set(playerKey, player);

    const events = Array.isArray(player?.events) ? player.events : [];
    timelineEvents += events.length;

    let previousTick = -Infinity;
    let reconstructed = emptyPlayerState(playerKey);
    const owned = new Set();
    const stableIdentity = {
      playerName: null,
      steamId: null,
      heroId: null,
      team: null,
    };
    const previousPermanentTotals = new Map();

    for (const event of events) {
      const tick = event?.tick;
      if (!Number.isFinite(tick) || tick <= previousTick) {
        checkFlags.eventTicksStrictlyIncreasing = false;
        contradictions.push({
          code: 'EVENT_TICKS_NOT_STRICTLY_INCREASING',
          playerKey,
          previousTick,
          tick,
        });
      }
      if (Number.isFinite(tick)) previousTick = tick;

      for (const row of event?.itemRemoves ?? []) {
        itemRemoves++;
        if (!owned.has(row?.itemId)) {
          checkFlags.itemOwnershipTransitionsCoherent = false;
          contradictions.push({
            code: 'ITEM_REMOVED_WHILE_NOT_OWNED',
            playerKey,
            tick,
            itemId: row?.itemId ?? null,
            recordKey: row?.recordKey ?? null,
          });
        }
        if (!validEffectReference(row, itemEffectRefs)) {
          checkFlags.itemEffectReferencesResolved = false;
          contradictions.push({
            code: 'ITEM_EFFECT_REFERENCE_UNRESOLVED',
            playerKey,
            tick,
            itemId: row?.itemId ?? null,
            effectInputRef: row?.effectInputRef ?? null,
          });
        }
      }

      for (const row of event?.itemAdds ?? []) {
        itemAdds++;
        if (owned.has(row?.itemId)) {
          checkFlags.itemOwnershipTransitionsCoherent = false;
          contradictions.push({
            code: 'ITEM_ADDED_WHILE_ALREADY_OWNED',
            playerKey,
            tick,
            itemId: row?.itemId ?? null,
            recordKey: row?.recordKey ?? null,
          });
        }
        if (!validEffectReference(row, itemEffectRefs)) {
          checkFlags.itemEffectReferencesResolved = false;
          contradictions.push({
            code: 'ITEM_EFFECT_REFERENCE_UNRESOLVED',
            playerKey,
            tick,
            itemId: row?.itemId ?? null,
            effectInputRef: row?.effectInputRef ?? null,
          });
        }
      }

      // Script158 applyStateEvent applies additions, then removals.
      for (const row of event?.itemAdds ?? []) if (row?.itemId !== undefined) owned.add(row.itemId);
      for (const row of event?.itemRemoves ?? []) if (row?.itemId !== undefined) owned.delete(row.itemId);

      if (event?.identity && typeof event.identity === 'object') {
        for (const [field, rawValue] of Object.entries(event.identity)) {
          if (!(field in stableIdentity)) continue;
          const value = normalizeStableIdentityValue(field, rawValue);
          if (value === null) continue;
          identityChecks++;
          if (stableIdentity[field] === null) stableIdentity[field] = value;
          else if (stableIdentity[field] !== value) {
            checkFlags.stableResolvedIdentity = false;
            contradictions.push({
              code: 'RESOLVED_IDENTITY_CHANGED',
              playerKey,
              tick,
              field,
              previous: stableIdentity[field],
              current: value,
            });
          }
        }
      }

      if (event?.permanentBuffState && typeof event.permanentBuffState === 'object') {
        permanentStateEvents++;
        const currentFamilies = new Set(Object.keys(event.permanentBuffState));

        for (const [family, row] of Object.entries(event.permanentBuffState)) {
          permanentFamiliesObserved.add(family);
          const total = Number(row?.totalValue);
          const units = Number(row?.inferredUnits);
          if (!Number.isFinite(total) || total < -EPSILON || !Number.isFinite(units) || units < -EPSILON) {
            checkFlags.permanentBuffStateFiniteNonnegative = false;
            contradictions.push({
              code: 'PERMANENT_STATE_NONFINITE_OR_NEGATIVE',
              playerKey,
              tick,
              family,
              totalValue: row?.totalValue ?? null,
              inferredUnits: row?.inferredUnits ?? null,
            });
          }

          const previous = previousPermanentTotals.get(family);
          if (Number.isFinite(previous) && Number.isFinite(total) && total + EPSILON < previous) {
            checkFlags.permanentBuffStateMonotonic = false;
            contradictions.push({
              code: 'PERMANENT_STATE_DECREASED',
              playerKey,
              tick,
              family,
              previousTotal: previous,
              currentTotal: total,
            });
          }
          if (Number.isFinite(total)) previousPermanentTotals.set(family, total);
        }

        for (const [family, previous] of previousPermanentTotals.entries()) {
          if (!currentFamilies.has(family) && previous > EPSILON) {
            checkFlags.permanentBuffStateMonotonic = false;
            contradictions.push({
              code: 'PERMANENT_FAMILY_DISAPPEARED',
              playerKey,
              tick,
              family,
              previousTotal: previous,
            });
          }
        }
      }

      const expectedActiveIds = activeIntervalIdsAt(intervals, playerKey, tick);
      const observedActiveIds = new Set(
        (event?.activeBridgeBuffs ?? [])
          .map(row => row?.intervalId)
          .filter(Boolean),
      );
      bridgeProjectedEventChecks++;
      if (!setEquals(expectedActiveIds, observedActiveIds)) {
        checkFlags.bridgeProjectionExactAtAllEvents = false;
        contradictions.push({
          code: 'BRIDGE_ACTIVE_PROJECTION_MISMATCH',
          playerKey,
          tick,
          expectedIntervalIds: [...expectedActiveIds].sort(),
          observedIntervalIds: [...observedActiveIds].sort(),
        });
      }

      reconstructed = applyStateEvent(reconstructed, event);
    }

    finalStateChecks++;
    if (!isDeepStrictEqual(reconstructed, player?.finalState)) {
      checkFlags.finalStateReconstructionExact = false;
      contradictions.push({
        code: 'FINAL_STATE_RECONSTRUCTION_MISMATCH',
        playerKey,
      });
    }
  }

  for (const interval of intervals) {
    const playerKey = interval?.playerKey;
    const player = playersByKey.get(playerKey);
    const startTick = interval?.startTick;
    const nominalEndTick = interval?.nominalEndTick;
    const stateEndTick = interval?.stateEndTick;
    const reason = interval?.terminationReason;
    const observed = interval?.terminationObserved;

    let wellFormed = Boolean(player)
      && Number.isFinite(startTick)
      && Number.isFinite(nominalEndTick)
      && Number.isFinite(stateEndTick)
      && nominalEndTick - startTick === durationTicks
      && stateEndTick > startTick
      && stateEndTick <= nominalEndTick
      && ['NATURAL_EXPIRATION', 'DEATH_TERMINATION', 'MATCH_END_CENSORED', 'REPLAY_END_CENSORED'].includes(reason);

    if (reason === 'NATURAL_EXPIRATION') wellFormed = wellFormed && stateEndTick === nominalEndTick && observed === true;
    if (reason === 'DEATH_TERMINATION') wellFormed = wellFormed && stateEndTick < nominalEndTick && observed === true;
    if (reason === 'MATCH_END_CENSORED' || reason === 'REPLAY_END_CENSORED') {
      wellFormed = wellFormed && stateEndTick < nominalEndTick && observed === false;
    }

    if (!wellFormed) {
      checkFlags.bridgeIntervalsWellFormed = false;
      contradictions.push({
        code: 'BRIDGE_INTERVAL_MALFORMED',
        intervalId: interval?.intervalId ?? null,
        playerKey,
        startTick,
        nominalEndTick,
        stateEndTick,
        terminationReason: reason,
        terminationObserved: observed,
      });
      continue;
    }

    const events = player.events ?? [];
    const startEvent = events.find(event => event.tick === startTick);
    const endEvent = events.find(event => event.tick === stateEndTick);
    const startHasBoundary = startEvent?.causes?.includes('BRIDGE_RUNTIME_INTERVAL') === true;
    const endHasBoundary = endEvent?.causes?.includes('BRIDGE_RUNTIME_INTERVAL') === true;
    const startProjectsInterval = (startEvent?.activeBridgeBuffs ?? []).some(row => row?.intervalId === interval.intervalId);
    const endProjectsInterval = (endEvent?.activeBridgeBuffs ?? []).some(row => row?.intervalId === interval.intervalId);

    if (!startEvent || !endEvent || !startHasBoundary || !endHasBoundary || !startProjectsInterval || endProjectsInterval) {
      checkFlags.bridgeBoundaryEventsPresent = false;
      contradictions.push({
        code: 'BRIDGE_BOUNDARY_EVENT_INVALID',
        intervalId: interval?.intervalId ?? null,
        playerKey,
        startTick,
        stateEndTick,
        startEventPresent: Boolean(startEvent),
        endEventPresent: Boolean(endEvent),
        startHasBoundary,
        endHasBoundary,
        startProjectsInterval,
        endProjectsInterval,
      });
    }
  }

  const heroRefsMissing = players
    .filter(player => !player?.heroResourceProfileRef || !heroProfileRefs.has(player.heroResourceProfileRef))
    .map(player => player?.playerKey ?? null);

  const semanticChecks = Object.fromEntries(
    Object.entries(checkFlags).map(([name, pass]) => [name, { pass: Boolean(pass) }]),
  );
  const semanticPass = Object.values(checkFlags).every(Boolean);

  const coverageChecks = {
    playersObservedAtLeastTen: check(players.length, '>=10', players.length >= 10),
    timelineLayerExercised: check(timelineEvents, '>0', timelineEvents > 0),
    shopLayerExercised: check(itemAdds + itemRemoves, '>0', itemAdds + itemRemoves > 0),
    permanentLayerExercised: check(permanentStateEvents, '>0', permanentStateEvents > 0),
    bridgeLayerExercised: check(intervals.length, '>0', intervals.length > 0),
    allSixPermanentFamiliesObserved: check(permanentFamiliesObserved.size, 6, permanentFamiliesObserved.size === 6),
    heroResourceReferencesCovered: check(heroRefsMissing.length, 0, heroRefsMissing.length === 0),
  };

  return {
    semanticValidation: {
      pass: semanticPass,
      checks: semanticChecks,
      contradictions,
    },
    coverageDiagnostics: {
      complete: Object.values(coverageChecks).every(row => row.pass),
      checks: coverageChecks,
      heroRefsMissing,
    },
    metrics: {
      players: players.length,
      timelineEvents,
      itemAdds,
      itemRemoves,
      itemTransitions: itemAdds + itemRemoves,
      permanentStateEvents,
      permanentFamiliesObserved: [...permanentFamiliesObserved].sort(),
      bridgeIntervals: intervals.length,
      bridgeProjectedEventChecks,
      finalStateChecks,
      identityChecks,
    },
  };
}

function activeIntervalIdsAt(intervals, playerKey, tick) {
  const out = new Set();
  if (!Number.isFinite(tick)) return out;
  for (const row of intervals) {
    if (row?.playerKey !== playerKey) continue;
    if (tick >= row.startTick && tick < row.stateEndTick && row?.intervalId) out.add(row.intervalId);
  }
  return out;
}

function validEffectReference(row, refs) {
  return row?.mapped === true
    && typeof row?.effectInputRef === 'string'
    && refs.has(row.effectInputRef);
}

function normalizeStableIdentityValue(field, value) {
  if (value === null || value === undefined) return null;
  if (field === 'playerName') {
    const text = String(value).trim();
    return text && text !== 'SourceTV' ? text : null;
  }
  if (field === 'steamId') {
    const text = String(value).trim();
    return text && text !== '0' ? text : null;
  }
  if (field === 'heroId') {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }
  if (field === 'team') {
    const number = Number(value);
    return Number.isInteger(number) && number > 1 ? number : null;
  }
  return value;
}

function setEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}
