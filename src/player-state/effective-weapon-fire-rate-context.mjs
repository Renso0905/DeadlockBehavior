const FIRE_RATE_RE = /(fire.?rate|firing.?rate|rate.?of.?fire|weapon.*fire.*rate)/i;

export function extractFireRateContext(context) {
  const directNumericInputs = [];
  const directUnresolvedInputs = [];
  const nonDirectTokens = [];

  for (const item of context?.itemInputs ?? []) {
    for (const stat of item?.directProvidedStats ?? []) {
      const type = String(stat?.providedPropertyType ?? '');
      if (!FIRE_RATE_RE.test(type)) continue;
      const row = {
        recordKey: item?.recordKey ?? null,
        providedPropertyType: stat?.providedPropertyType ?? null,
        numericValue: Number.isFinite(stat?.numericValue) ? stat.numericValue : null,
        value: stat?.value ?? null,
      };
      if (Number.isFinite(row.numericValue)) directNumericInputs.push(row);
      else directUnresolvedInputs.push(row);
    }

    for (const token of item?.nonDirectModifierTokens ?? []) {
      if (!FIRE_RATE_RE.test(String(token ?? ''))) continue;
      nonDirectTokens.push({ recordKey: item?.recordKey ?? null, token });
    }
  }

  directNumericInputs.sort(compareJson);
  directUnresolvedInputs.sort(compareJson);
  nonDirectTokens.sort(compareJson);

  const permanentFireRate = [];
  for (const [family, row] of Object.entries(context?.permanentWeaponBuffs ?? {})) {
    if (!FIRE_RATE_RE.test(family)) continue;
    permanentFireRate.push({
      family,
      totalValue: Number.isFinite(row?.totalValue) ? row.totalValue : null,
      inferredUnits: Number.isFinite(row?.inferredUnits) ? row.inferredUnits : null,
    });
  }
  permanentFireRate.sort((a, b) => a.family.localeCompare(b.family));

  const gunBridgeActive = (context?.gunBridge ?? []).length > 0;

  const signatureObject = {
    directNumericInputs,
    directUnresolvedInputs,
    nonDirectTokens,
    permanentFireRate,
    gunBridgeActive,
  };

  return {
    ...signatureObject,
    signature: JSON.stringify(signatureObject),
  };
}

export function classifyFireRateContextChange(before, after) {
  const signs = [];
  const evidence = [];
  let ambiguous = false;

  const directBefore = keyedNumericMap(before?.directNumericInputs ?? [], row => `${row.recordKey}|${row.providedPropertyType}`);
  const directAfter = keyedNumericMap(after?.directNumericInputs ?? [], row => `${row.recordKey}|${row.providedPropertyType}`);
  for (const key of unionKeys(directBefore, directAfter)) {
    const a = directBefore.get(key) ?? 0;
    const b = directAfter.get(key) ?? 0;
    const delta = b - a;
    if (Math.abs(delta) <= 1e-12) continue;
    signs.push(Math.sign(delta));
    evidence.push({ source: 'DIRECT_ITEM_FIRE_RATE', key, before: a, after: b, delta });
  }

  const permBefore = keyedNumericMap(before?.permanentFireRate ?? [], row => row.family, row => row.totalValue);
  const permAfter = keyedNumericMap(after?.permanentFireRate ?? [], row => row.family, row => row.totalValue);
  for (const key of unionKeys(permBefore, permAfter)) {
    const a = permBefore.get(key) ?? 0;
    const b = permAfter.get(key) ?? 0;
    const delta = b - a;
    if (Math.abs(delta) <= 1e-12) continue;
    signs.push(Math.sign(delta));
    evidence.push({ source: 'PERMANENT_FIRE_RATE', key, before: a, after: b, delta });
  }

  const gunBefore = Boolean(before?.gunBridgeActive);
  const gunAfter = Boolean(after?.gunBridgeActive);
  if (gunBefore !== gunAfter) {
    const delta = gunAfter ? 1 : -1;
    signs.push(delta);
    evidence.push({ source: 'GUN_BRIDGE_FIRE_RATE', key: 'gun_powerup_pickup', before: gunBefore, after: gunAfter, delta });
  }

  const unresolvedBefore = JSON.stringify({
    directUnresolvedInputs: before?.directUnresolvedInputs ?? [],
    nonDirectTokens: before?.nonDirectTokens ?? [],
  });
  const unresolvedAfter = JSON.stringify({
    directUnresolvedInputs: after?.directUnresolvedInputs ?? [],
    nonDirectTokens: after?.nonDirectTokens ?? [],
  });
  if (unresolvedBefore !== unresolvedAfter) ambiguous = true;

  const nonzero = signs.filter(sign => sign !== 0);
  let expectedReadyDirection = 'NO_DIRECTIONAL_FIRE_RATE_CHANGE';
  if (ambiguous) expectedReadyDirection = 'AMBIGUOUS_UNRESOLVED_FIRE_RATE_CHANGE';
  else if (nonzero.length > 0 && nonzero.every(sign => sign > 0)) expectedReadyDirection = 'READY_DELAY_SHOULD_DECREASE';
  else if (nonzero.length > 0 && nonzero.every(sign => sign < 0)) expectedReadyDirection = 'READY_DELAY_SHOULD_INCREASE';
  else if (nonzero.length > 0) expectedReadyDirection = 'MIXED_DIRECTION_FIRE_RATE_CHANGE';

  return {
    expectedReadyDirection,
    directional: expectedReadyDirection === 'READY_DELAY_SHOULD_DECREASE' || expectedReadyDirection === 'READY_DELAY_SHOULD_INCREASE',
    ambiguous,
    evidence,
    sourceKinds: [...new Set(evidence.map(row => row.source))].sort(),
  };
}

export function buildDischargeSegments(rows, contextsById) {
  const byWeapon = new Map();
  for (const row of rows ?? []) {
    if (row?.transition?.actualDischargeSignal !== true) continue;
    if (!Number.isFinite(row?.transition?.readyDelayCandidateSeconds)) continue;
    if (!Number.isInteger(row?.weaponEntityIndex)) continue;
    const context = contextsById.get(row.effectContextId) ?? null;
    if (!context) continue;
    const fireRateContext = extractFireRateContext(context);
    const activeFireMode = Number.isFinite(row?.observedWeaponState?.activeFireMode)
      ? row.observedWeaponState.activeFireMode
      : null;
    const enriched = { ...row, fireRateContext, activeFireMode };
    if (!byWeapon.has(row.weaponEntityIndex)) byWeapon.set(row.weaponEntityIndex, []);
    byWeapon.get(row.weaponEntityIndex).push(enriched);
  }

  const segments = [];
  for (const [weaponEntityIndex, weaponRows] of byWeapon.entries()) {
    weaponRows.sort((a, b) => a.tick - b.tick);
    let current = null;
    for (const row of weaponRows) {
      const key = `${row.fireRateContext.signature}|mode:${String(row.activeFireMode)}`;
      if (!current || current.segmentKey !== key) {
        current = {
          weaponEntityIndex,
          playerKey: row.playerKey ?? null,
          heroId: row.heroId ?? null,
          effectContextId: row.effectContextId ?? null,
          fireRateContext: row.fireRateContext,
          activeFireMode: row.activeFireMode,
          segmentKey: key,
          rows: [],
        };
        segments.push(current);
      }
      current.rows.push(row);
    }
  }
  return segments;
}

export function buildAdjacentFireRateTransitions(segments, windowSize = 8, minimumWindow = 3) {
  const byWeapon = new Map();
  for (const segment of segments ?? []) {
    if (!byWeapon.has(segment.weaponEntityIndex)) byWeapon.set(segment.weaponEntityIndex, []);
    byWeapon.get(segment.weaponEntityIndex).push(segment);
  }

  const out = [];
  for (const weaponSegments of byWeapon.values()) {
    weaponSegments.sort((a, b) => firstTick(a) - firstTick(b));
    for (let i = 0; i + 1 < weaponSegments.length; i++) {
      const before = weaponSegments[i];
      const after = weaponSegments[i + 1];
      if (before.fireRateContext.signature === after.fireRateContext.signature) continue;
      if (before.activeFireMode !== after.activeFireMode) continue;

      const beforeRows = before.rows.slice(-windowSize);
      const afterRows = after.rows.slice(0, windowSize);
      const change = classifyFireRateContextChange(before.fireRateContext, after.fireRateContext);
      const beforeReady = median(beforeRows.map(row => row.transition.readyDelayCandidateSeconds));
      const afterReady = median(afterRows.map(row => row.transition.readyDelayCandidateSeconds));
      const readyDelta = Number.isFinite(beforeReady) && Number.isFinite(afterReady) ? afterReady - beforeReady : null;
      const relativeChange = Number.isFinite(readyDelta) && Number.isFinite(beforeReady) && Math.abs(beforeReady) > 1e-12
        ? readyDelta / beforeReady
        : null;
      const enoughWindow = beforeRows.length >= minimumWindow && afterRows.length >= minimumWindow;
      const directionAgreement = change.directional && enoughWindow && Number.isFinite(readyDelta)
        ? change.expectedReadyDirection === 'READY_DELAY_SHOULD_DECREASE'
          ? readyDelta < -1e-9
          : readyDelta > 1e-9
        : null;

      out.push({
        weaponEntityIndex: before.weaponEntityIndex,
        playerKey: before.playerKey ?? after.playerKey ?? null,
        heroId: before.heroId ?? after.heroId ?? null,
        activeFireMode: before.activeFireMode,
        beforeEffectContextId: before.effectContextId,
        afterEffectContextId: after.effectContextId,
        boundaryTick: firstTick(after),
        beforeSamples: beforeRows.length,
        afterSamples: afterRows.length,
        enoughWindow,
        beforeReadyMedianSeconds: beforeReady,
        afterReadyMedianSeconds: afterReady,
        readyDeltaSeconds: readyDelta,
        relativeReadyChange: relativeChange,
        change,
        directionAgreement,
      });
    }
  }
  return out;
}

function firstTick(segment) {
  return segment?.rows?.[0]?.tick ?? Infinity;
}

function keyedNumericMap(rows, keyFn, valueFn = row => row.numericValue) {
  const map = new Map();
  for (const row of rows) {
    const value = valueFn(row);
    if (!Number.isFinite(value)) continue;
    map.set(keyFn(row), value);
  }
  return map;
}

function unionKeys(a, b) {
  return new Set([...a.keys(), ...b.keys()]);
}

function compareJson(a, b) {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
