import { buildPlayerTimeline, stateAtTick } from './runtime-state-timeline.mjs';

const WEAPON_FAMILY_RE = /(fire.?rate|ammo|clip|weapon.*damage|weapon_damage|bullet)/i;

export function buildIntegratedPlayerStateIndex(integratedArtifact) {
  const byPlayer = new Map();
  for (const player of integratedArtifact?.players ?? []) {
    const playerKey = player?.playerKey ?? player?.identity?.playerName ?? null;
    if (!playerKey) continue;
    const timeline = buildPlayerTimeline({ events: player.events ?? [] });
    byPlayer.set(playerKey, {
      playerKey,
      identity: player.identity ?? {},
      timeline,
    });
  }
  return byPlayer;
}

export function integratedStateAt(index, playerKey, tick) {
  const row = index?.get(playerKey);
  if (!row) return null;
  return stateAtTick(row.timeline, tick);
}

export function compareObservedWeaponState(previous, current) {
  if (!previous) {
    return {
      shotNumberDelta: 0,
      lastAttackTimeAdvanced: false,
      clipDelta: 0,
      firedRecentlyRise: false,
      actualDischargeSignal: false,
      readyDelayCandidateSeconds: null,
    };
  }

  const shotNumberDelta = finiteDelta(previous.shotNumber, current.shotNumber);
  const lastAttackTimeAdvanced = Number.isFinite(previous.lastAttackTime)
    && Number.isFinite(current.lastAttackTime)
    && current.lastAttackTime > previous.lastAttackTime + 1e-6;
  const clipDelta = finiteDelta(previous.clip, current.clip);
  const firedRecentlyRise = previous.firedRecently === false && current.firedRecently === true;
  const readyDelayCandidateSeconds = Number.isFinite(current.lastAttackTime)
    && Number.isFinite(current.nextPrimaryAttack)
    && current.nextPrimaryAttack >= current.lastAttackTime
    ? current.nextPrimaryAttack - current.lastAttackTime
    : null;

  return {
    shotNumberDelta,
    lastAttackTimeAdvanced,
    clipDelta,
    firedRecentlyRise,
    actualDischargeSignal: shotNumberDelta > 0 || lastAttackTimeAdvanced,
    readyDelayCandidateSeconds,
  };
}

export function buildWeaponEffectContext(playerState, effectsByKey) {
  const itemInputs = [];
  let unresolvedItemEffectRefs = 0;

  for (const owned of playerState?.authoritativeOwnership?.standardShopItems ?? []) {
    const recordKey = owned?.recordKey ?? null;
    if (!recordKey) continue;
    const effect = effectsByKey?.get(recordKey) ?? null;
    if (!effect) {
      unresolvedItemEffectRefs++;
      continue;
    }
    const weapon = effect.weaponStateRelevant ?? {};
    if (!weapon.hasMechanicEffectEvidence) continue;

    itemInputs.push({
      recordKey,
      itemId: owned.itemId ?? null,
      directProvidedStats: compactProvidedStats(weapon.directProvidedStats ?? []),
      nonDirectModifierTokens: [...(weapon.nonDirectModifierTokens ?? [])],
      operationRelevant: Boolean(weapon?.operation?.hasEffectEvidence),
      damageOrPowerRelevant: Boolean(weapon?.damageOrPower?.hasEffectEvidence),
      semanticClass: (weapon.nonDirectModifierTokens ?? []).length > 0
        ? 'MIXED_DIRECT_AND_OR_NON_DIRECT_EFFECT_INPUT'
        : 'DIRECT_PROVIDED_EFFECT_INPUT',
    });
  }

  itemInputs.sort((a, b) => a.recordKey.localeCompare(b.recordKey));

  const permanentWeaponBuffs = {};
  for (const [family, row] of Object.entries(
    playerState?.authoritativeOwnership?.permanentWorldBuffs ?? {}
  )) {
    if (!WEAPON_FAMILY_RE.test(family)) continue;
    permanentWeaponBuffs[family] = {
      totalValue: row?.totalValue ?? null,
      inferredUnits: row?.inferredUnits ?? null,
      sourceRows: (row?.rows ?? []).map(source => ({
        recordKey: source?.recordKey ?? null,
        tier: source?.tier ?? null,
        value: source?.value ?? null,
        unitValue: source?.unitValue ?? null,
      })),
    };
  }

  const activeBridgeBuffs = playerState?.authoritativeOwnership?.activeBridgeBuffs ?? [];
  const gunBridge = activeBridgeBuffs
    .filter(row => row?.recordKey === 'gun_powerup_pickup' || row?.buffType === 'gun_powerup_pickup')
    .map(row => ({
      intervalId: row.intervalId ?? null,
      recordKey: row.recordKey ?? row.buffType ?? null,
      startTick: row.startTick ?? null,
      stateEndTick: row.stateEndTick ?? null,
      terminationReason: row.terminationReason ?? null,
    }));

  return {
    itemInputs,
    permanentWeaponBuffs,
    gunBridge,
    unresolvedItemEffectRefs,
    heroId: playerState?.identity?.heroId ?? null,
    heroProfileRef: Number.isInteger(playerState?.identity?.heroId)
      ? `hero:${playerState.identity.heroId}`
      : null,
  };
}

export function clipCapacityDiagnostic(weaponState, playerState) {
  const clip = weaponState?.clip;
  const maxAmmo = playerState?.observedRuntime?.maxAmmo;
  const bonusClip = weaponState?.bonusClip;
  if (!Number.isFinite(clip) || !Number.isFinite(maxAmmo)) {
    return { comparable: false, withinObservedCapacity: null, capacityCeiling: null };
  }
  const capacityCeiling = maxAmmo + (Number.isFinite(bonusClip) && bonusClip > 0 ? bonusClip : 0);
  return {
    comparable: true,
    withinObservedCapacity: clip >= 0 && clip <= capacityCeiling + 1e-6,
    capacityCeiling,
  };
}

export function classifyReloadTransition(previous, current) {
  if (!previous) return null;
  if (previous.inReload !== true && current.inReload === true) return 'RELOAD_ENTER';
  if (previous.inReload === true && current.inReload !== true) return 'RELOAD_EXIT';
  if (Number.isFinite(previous.clip) && Number.isFinite(current.clip) && current.clip > previous.clip) {
    return 'CLIP_INCREASE';
  }
  return null;
}

function compactProvidedStats(rows) {
  return rows.map(row => ({
    providedPropertyType: row?.providedPropertyType ?? null,
    value: row?.value ?? null,
    numericValue: Number.isFinite(row?.numericValue) ? row.numericValue : null,
  }));
}

function finiteDelta(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : 0;
}

export function joinWeaponEventsToIntegratedState(weaponEvents, playerArtifact) {
  const stateEvents = [...(playerArtifact?.events ?? [])].sort((a, b) => a.tick - b.tick);
  const rows = [...(weaponEvents ?? [])].sort((a, b) => a.tick - b.tick);
  let cursor = 0;
  let state = null;
  const { playerKey = playerArtifact?.playerKey ?? playerArtifact?.identity?.playerName ?? null } = playerArtifact ?? {};

  return rows.map(row => {
    while (cursor < stateEvents.length && stateEvents[cursor].tick <= row.tick) {
      state = applyImportedStateEvent(state, stateEvents[cursor], playerKey);
      cursor++;
    }
    return { ...row, integratedPlayerState: cloneSafe(state) };
  });
}

function applyImportedStateEvent(state, event, playerKey) {
  const base = state ?? {
    tick: null,
    playerKey,
    identity: { playerName: null, steamId: null, controllerEntityIndex: null, heroId: null, team: null },
    observedRuntime: { level: null, alive: null, health: null, healthMax: null, healthRegen: null, maxAmmo: null, goldNetWorth: null, apNetWorth: null, respawnTime: null },
    authoritativeOwnership: { standardShopItems: [], permanentWorldBuffs: {}, activeBridgeBuffs: [] },
  };
  const next = cloneSafe(base);
  if (event.identity) next.identity = { ...next.identity, ...event.identity };
  if (event.observedRuntime) next.observedRuntime = { ...next.observedRuntime, ...event.observedRuntime };
  if (Array.isArray(event.itemAdds) || Array.isArray(event.itemRemoves)) {
    const map = new Map((next.authoritativeOwnership.standardShopItems ?? []).map(item => [item.itemId, item]));
    for (const item of event.itemAdds ?? []) if (item?.itemId !== undefined) map.set(item.itemId, item);
    for (const item of event.itemRemoves ?? []) if (item?.itemId !== undefined) map.delete(item.itemId);
    next.authoritativeOwnership.standardShopItems = [...map.values()].sort((a, b) => String(a.recordKey ?? '').localeCompare(String(b.recordKey ?? '')));
  }
  if (event.permanentBuffState) next.authoritativeOwnership.permanentWorldBuffs = cloneSafe(event.permanentBuffState);
  if (Array.isArray(event.activeBridgeBuffs)) next.authoritativeOwnership.activeBridgeBuffs = cloneSafe(event.activeBridgeBuffs);
  next.tick = event.tick;
  return next;
}

function cloneSafe(value) {
  if (value === null || value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
