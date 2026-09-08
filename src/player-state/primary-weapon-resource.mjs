const STATIC_FIELDS = [
  'm_flBulletDamage',
  'm_iBullets',
  'm_iClipSize',
  'm_flCycleTime',
  'm_flBulletCreationDelay',
  'm_iBurstShotCount',
  'm_flIntraBurstCycleTime',
  'm_iAmmoConsumedPerShot',
  'm_flRange',
  'm_reloadDuration',
  'm_bReloadSingleBullets',
  'm_flReloadSingleBulletsInitialDelay',
  'm_bSpinsUp',
  'm_flMaxSpinCycleTime',
  'm_flSpinIncreaseRate',
  'm_flSpinDecayRate',
  'm_flBuildUpRate',
  'm_bIsSemiAuto',
  'm_flBulletSpeed',
  'm_flBulletSpeedRandomFactor'
];

export function findHeroPrimaryWeaponBindings(root) {
  const rows = [];
  const seen = new Set();

  walk(root, value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const heroId = finite(value.heroId);
    const bound = value.boundAbilities;
    const primaryWeaponRecordKey =
      bound && typeof bound === 'object'
        ? scalarString(bound.ESlot_Weapon_Primary)
        : null;

    if (heroId === null || !primaryWeaponRecordKey || seen.has(heroId)) return;
    seen.add(heroId);

    rows.push(extractHeroPrimaryWeaponBinding(value));
  });

  return rows.sort((a, b) => a.heroId - b.heroId);
}


export function findSelectableHeroPrimaryWeaponBindings(root) {
  const heroes = Array.isArray(root?.heroes) ? root.heroes : [];

  return heroes
    .filter(value => value && typeof value === 'object' && value.playerSelectable === true)
    .map(extractHeroPrimaryWeaponBinding)
    .filter(Boolean)
    .sort((a, b) => a.heroId - b.heroId);
}

export function extractPrimaryWeaponInfo(recordText) {
  const fields = {};
  const occurrenceCounts = {};
  const conflictingFields = [];

  for (const fieldName of STATIC_FIELDS) {
    const values = captureAllScalars(recordText, fieldName);
    occurrenceCounts[fieldName] = values.length;
    fields[fieldName] = values.length ? values[0] : null;

    const signatures = new Set(values.map(value => JSON.stringify(value)));
    if (signatures.size > 1) {
      conflictingFields.push({ fieldName, values });
    }
  }

  return {
    fields,
    occurrenceCounts,
    conflictingFields,
    cadenceRegime: classifyStaticCadenceRegime(fields)
  };
}

export function classifyStaticCadenceRegime(fields) {
  const burstShotCount = finite(fields?.m_iBurstShotCount);
  const cycleTime = finite(fields?.m_flCycleTime);
  const intraBurstCycleTime = finite(fields?.m_flIntraBurstCycleTime);
  const spinsUp = fields?.m_bSpinsUp === true;

  let regime;
  if (spinsUp) regime = 'SPIN_UP';
  else if (burstShotCount !== null && burstShotCount > 1) regime = 'BURST';
  else if (burstShotCount === 1) regime = 'SINGLE_OR_AUTOMATIC_NON_BURST';
  else regime = 'UNRESOLVED';

  return {
    regime,
    cycleTimeSeconds: cycleTime,
    intraBurstCycleTimeSeconds: intraBurstCycleTime,
    burstShotCount,
    spinsUp,
    staticInterpretation: {
      cycleTime: 'RESOURCE_FIELD_CANDIDATE_FOR_TIME_BETWEEN_SHOTS_OR_BURST_STARTS_NOT_RUNTIME_EFFECTIVE_CADENCE',
      intraBurstCycleTime: 'RESOURCE_FIELD_CANDIDATE_FOR_WITHIN_BURST_SHOT_INTERVAL_ONLY_WHEN_BURST_COUNT_GT_1',
      spinUp: 'STATIC_FLAG_REQUIRES_DYNAMIC_RUNTIME_SPIN_STATE_MODEL'
    }
  };
}

export function captureAllScalars(text, fieldName) {
  const escaped = escapeRegex(fieldName);
  const re = new RegExp(`\\b${escaped}\\s*=\\s*([^\\r\\n,}]+)`, 'g');
  const result = [];
  for (const match of String(text ?? '').matchAll(re)) {
    result.push(parseScalar(match[1]));
  }
  return result;
}


function extractHeroPrimaryWeaponBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const heroId = finite(value.heroId);
  const bound = value.boundAbilities;
  const primaryWeaponRecordKey =
    bound && typeof bound === 'object'
      ? scalarString(bound.ESlot_Weapon_Primary)
      : null;

  if (heroId === null || !primaryWeaponRecordKey) return null;

  const fireRateScaling = Array.isArray(value.scalingStats)
    ? value.scalingStats
        .filter(row => String(row?.recordKey ?? '') === 'EFireRate')
        .map(row => ({
          scalingStat: scalarString(row?.scalingStat ?? row?.raw?.eScalingStat),
          scale: finite(row?.scale ?? row?.raw?.flScale)
        }))
    : [];

  return {
    heroId,
    displayName: scalarString(value.displayName),
    internalKey: scalarString(value.internalKey),
    primaryWeaponRecordKey,
    fireRateScaling
  };
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  if (Array.isArray(value)) {
    for (const row of value) walk(row, visit);
  } else {
    for (const row of Object.values(value)) walk(row, visit);
  }
}

function parseScalar(raw) {
  const text = String(raw ?? '').trim();
  if (/^".*"$/.test(text)) return text.slice(1, -1);
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  const n = Number(text);
  return Number.isFinite(n) ? n : text || null;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scalarString(value) {
  return typeof value === 'string' && value.length ? value : null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const PRIMARY_WEAPON_RESOURCE_FIELDS = Object.freeze([...STATIC_FIELDS]);
