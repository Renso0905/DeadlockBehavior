const DEFAULT_TICKS_PER_SECOND = 64;

export function buildBridgeIntervals({
  collections = [],
  deaths = [],
  postGameTick = null,
  replayEndTick = null,
  durationSeconds = 160,
  ticksPerSecond = DEFAULT_TICKS_PER_SECOND,
} = {}) {
  const durationTicks = Math.round(durationSeconds * ticksPerSecond);
  const deathsByPlayer = groupSortedTicks(deaths, row => row.playerKey ?? row.playerName ?? null);

  return collections
    .filter(row => Number.isFinite(row?.tick) && (row.playerKey ?? row.playerName))
    .map((row, index) => {
      const playerKey = row.playerKey ?? row.playerName;
      const nominalEndTick = row.tick + durationTicks;
      const nextDeathTick = firstTickAfter(deathsByPlayer.get(playerKey) ?? [], row.tick);

      const candidates = [
        { tick: nominalEndTick, reason: 'NATURAL_EXPIRATION', observed: true },
      ];
      if (Number.isFinite(nextDeathTick) && nextDeathTick < nominalEndTick) {
        candidates.push({ tick: nextDeathTick, reason: 'DEATH_TERMINATION', observed: true });
      }
      if (Number.isFinite(postGameTick) && postGameTick < nominalEndTick) {
        candidates.push({ tick: postGameTick, reason: 'MATCH_END_CENSORED', observed: false });
      }
      if (Number.isFinite(replayEndTick) && replayEndTick < nominalEndTick) {
        candidates.push({ tick: replayEndTick, reason: 'REPLAY_END_CENSORED', observed: false });
      }

      candidates.sort((a, b) => a.tick - b.tick || terminationPriority(a.reason) - terminationPriority(b.reason));
      const end = candidates[0];

      return {
        intervalId: row.intervalId ?? `bridge-${index + 1}`,
        playerKey,
        playerName: row.playerName ?? playerKey,
        buffType: row.buffType ?? row.recordKey ?? null,
        recordKey: row.recordKey ?? row.buffType ?? null,
        startTick: row.tick,
        nominalEndTick,
        stateEndTick: end.tick,
        terminationReason: end.reason,
        terminationObserved: end.observed,
        source: row.source ?? 'RECONSTRUCTED_FROM_VALIDATED_COLLECTION',
        collectionDistanceHU: row.collectionDistanceHU ?? null,
        spawnerIndex: row.spawnerIndex ?? null,
      };
    })
    .sort(compareIntervals);
}

export function isBridgeIntervalActive(interval, tick) {
  if (!interval || !Number.isFinite(tick)) return false;
  return tick >= interval.startTick && tick < interval.stateEndTick;
}

export function activeBridgeIntervalsAt(intervals, playerKey, tick) {
  return (intervals ?? []).filter(row => row.playerKey === playerKey && isBridgeIntervalActive(row, tick));
}

export function applyStateEvent(state, event) {
  const next = cloneState(state ?? emptyPlayerState(event?.playerKey ?? null));
  if (!event) return next;

  if (event.identity && typeof event.identity === 'object') {
    next.identity = { ...next.identity, ...event.identity };
  }
  if (event.observedRuntime && typeof event.observedRuntime === 'object') {
    next.observedRuntime = { ...next.observedRuntime, ...event.observedRuntime };
  }
  if (Array.isArray(event.itemAdds) || Array.isArray(event.itemRemoves)) {
    const map = new Map((next.authoritativeOwnership.standardShopItems ?? []).map(row => [row.itemId, row]));
    for (const row of event.itemAdds ?? []) if (row?.itemId !== undefined) map.set(row.itemId, row);
    for (const row of event.itemRemoves ?? []) if (row?.itemId !== undefined) map.delete(row.itemId);
    next.authoritativeOwnership.standardShopItems = [...map.values()].sort(compareItems);
  }
  if (event.permanentBuffState) {
    next.authoritativeOwnership.permanentWorldBuffs = structuredCloneSafe(event.permanentBuffState);
  }
  if (Array.isArray(event.activeBridgeBuffs)) {
    next.authoritativeOwnership.activeBridgeBuffs = structuredCloneSafe(event.activeBridgeBuffs);
  }
  next.tick = event.tick ?? next.tick;
  return next;
}

export function buildPlayerTimeline({ events = [], initialState = null } = {}) {
  const sorted = [...events].sort(compareEvents);
  let state = initialState ? cloneState(initialState) : emptyPlayerState(sorted[0]?.playerKey ?? null);
  const timeline = [];

  for (const event of sorted) {
    state = applyStateEvent(state, event);
    timeline.push({
      tick: event.tick,
      causes: [...new Set(event.causes ?? [])].sort(),
      state: cloneState(state),
    });
  }
  return timeline;
}

export function stateAtTick(timeline, tick) {
  if (!Array.isArray(timeline) || timeline.length === 0 || !Number.isFinite(tick)) return null;
  let lo = 0;
  let hi = timeline.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (timeline[mid].tick <= tick) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? cloneState(timeline[best].state) : null;
}

export function emptyPlayerState(playerKey = null) {
  return {
    tick: null,
    playerKey,
    identity: {
      playerName: null,
      steamId: null,
      controllerEntityIndex: null,
      heroId: null,
      team: null,
    },
    observedRuntime: {
      level: null,
      alive: null,
      health: null,
      healthMax: null,
      healthRegen: null,
      maxAmmo: null,
      goldNetWorth: null,
      apNetWorth: null,
      respawnTime: null,
    },
    authoritativeOwnership: {
      standardShopItems: [],
      permanentWorldBuffs: {},
      activeBridgeBuffs: [],
    },
  };
}

export function compareEvents(a, b) {
  return (a?.tick ?? Infinity) - (b?.tick ?? Infinity)
    || String(a?.eventType ?? '').localeCompare(String(b?.eventType ?? ''));
}

function groupSortedTicks(rows, keyFn) {
  const map = new Map();
  for (const row of rows ?? []) {
    const key = keyFn(row);
    if (!key || !Number.isFinite(row?.tick)) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row.tick);
  }
  for (const values of map.values()) values.sort((a, b) => a - b);
  return map;
}

function firstTickAfter(ticks, tick) {
  let lo = 0;
  let hi = ticks.length - 1;
  let answer = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ticks[mid] > tick) {
      answer = ticks[mid];
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return answer;
}

function terminationPriority(reason) {
  if (reason === 'DEATH_TERMINATION') return 0;
  if (reason === 'MATCH_END_CENSORED') return 1;
  if (reason === 'REPLAY_END_CENSORED') return 2;
  return 3;
}

function compareIntervals(a, b) {
  return a.startTick - b.startTick
    || String(a.playerKey).localeCompare(String(b.playerKey))
    || String(a.recordKey).localeCompare(String(b.recordKey));
}

function compareItems(a, b) {
  return String(a.recordKey ?? '').localeCompare(String(b.recordKey ?? ''))
    || Number(a.itemId ?? 0) - Number(b.itemId ?? 0);
}

function cloneState(value) {
  return structuredCloneSafe(value);
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
